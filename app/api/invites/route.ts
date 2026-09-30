import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabaseClient } from '@/lib/supabase/server'
import { getUserFromRequest } from '@/lib/auth/get-user'
import { isSuperAdmin } from '@/lib/auth/superadmin'
import { canAssignRole } from '@/lib/auth/roles'
import { getAppUrl } from '@/lib/utils/app-url'
import { sendTeamInviteEmail } from '@/lib/utils/email'
import { z } from 'zod'

const inviteSchema = z.object({
  team_id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['MEMBER', 'MANAGER', 'ADMIN']).default('MEMBER'),
})

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const supabase = createServiceSupabaseClient()
    const body = await request.json()
    const { team_id, email, role } = inviteSchema.parse(body)

    const isSuperAdminUser = isSuperAdmin(user)

    if (!isSuperAdminUser) {
      // Verify user is admin/manager of team
      const { data: teamMember } = await supabase
        .from('team_members')
        .select('role')
        .eq('team_id', team_id)
        .eq('user_id', user.id)
        .single()

      const memberRole = (teamMember as { role: 'MEMBER' | 'MANAGER' | 'ADMIN' } | null)?.role
      if (!teamMember || !memberRole || !['ADMIN', 'MANAGER'].includes(memberRole)) {
        return NextResponse.json(
          { error: 'Only admins and managers can send invites' },
          { status: 403 }
        )
      }

      // Only admins/superadmins may grant elevated roles; managers add members only.
      if (!canAssignRole({ isSuperAdmin: false, teamRole: memberRole }, role)) {
        return NextResponse.json(
          { error: 'Only admins can assign the MANAGER or ADMIN role. Managers can add members only.' },
          { status: 403 }
        )
      }
    }

    // Check if user already exists in public.users
    let { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single()
    
    let existingUserData: { id: string } | null = existingUser as { id: string } | null

    // If not in public.users, check auth.users and create record
    if (!existingUser) {
      const { data: authUsers } = await supabase.auth.admin.listUsers()
      const authUser = authUsers?.users.find(
        (u: any) => u.email?.toLowerCase() === email.toLowerCase()
      )
      
      if (authUser) {
        // User exists in auth but not in public.users - create the record
        const { data: newUser, error: createError } = await supabase
          .from('users')
          .insert({
            id: authUser.id,
            email: authUser.email!,
            full_name: authUser.user_metadata?.full_name || null,
          } as any)
          .select('id')
          .single()

        if (createError && !createError.message.includes('duplicate')) {
          return NextResponse.json(
            { error: `Failed to create user record: ${createError.message}` },
            { status: 400 }
          )
        }

        existingUserData = (newUser as { id: string } | null) || { id: authUser.id }
      }
    }

    if (existingUserData) {
      // User exists - check if already a member
      const { data: existingMember } = await supabase
        .from('team_members')
        .select('id')
        .eq('team_id', team_id)
        .eq('user_id', existingUserData.id)
        .single()

      if (existingMember) {
        return NextResponse.json(
          { error: 'User is already a member of this team' },
          { status: 400 }
        )
      }

      // Add directly to team
      const { data: member, error: memberError } = await supabase
        .from('team_members')
        .insert({
          team_id,
          user_id: existingUserData.id,
          role,
        } as any)
        .select()
        .single()

      if (memberError) {
        return NextResponse.json(
          { error: memberError.message },
          { status: 400 }
        )
      }

      return NextResponse.json({ 
        success: true,
        message: 'User added to team',
        member 
      })
    }

    // New users get an app-owned invitation. generateLink mints the one-time
    // Supabase token without sending Supabase's default email.
    const { data: inviteData, error: inviteError } = await supabase.auth.admin.generateLink({
      type: 'invite',
      email,
    } as any)

    const invitedUser = (inviteData as any)?.user
    const hashedToken = (inviteData as any)?.properties?.hashed_token

    if (inviteError || !invitedUser || !hashedToken) {
      return NextResponse.json(
        { error: inviteError?.message || 'Could not create invitation' },
        { status: 400 }
      )
    }

    const rollbackInvitedUser = async () => {
      const { error: cleanupError } = await supabase.auth.admin.deleteUser(invitedUser.id)
      if (cleanupError) {
        console.error('[INVITES] Failed to roll back invited user:', cleanupError.message)
      }
    }

    // Authorization-sensitive invite state belongs in app_metadata because users
    // cannot edit it themselves. The browser never gets to choose team_id/role.
    const pendingTeamInvite = {
      team_id,
      role,
      invited_by: user.id,
      issued_at: new Date().toISOString(),
    }
    const { error: metadataError } = await supabase.auth.admin.updateUserById(
      invitedUser.id,
      {
        app_metadata: {
          ...(invitedUser.app_metadata || {}),
          pending_team_invite: pendingTeamInvite,
        },
      }
    )

    if (metadataError) {
      await rollbackInvitedUser()
      return NextResponse.json(
        { error: 'Could not secure invitation metadata. Please try again.' },
        { status: 500 }
      )
    }

    const { data: team } = await supabase
      .from('teams')
      .select('name')
      .eq('id', team_id)
      .maybeSingle()

    // The email points to our app, not /auth/v1/verify. The acceptance page
    // requires an explicit button click before consuming the one-time token,
    // which also protects against email-provider link prefetching.
    const inviteUrl = `${getAppUrl()}/auth/accept-invite?token_hash=${encodeURIComponent(hashedToken)}&type=invite`
    const sendResult = await sendTeamInviteEmail({
      to: email,
      inviteUrl,
      teamName: (team as { name?: string } | null)?.name || null,
      role,
    })

    if (!sendResult.success) {
      console.error('[INVITES] Invitation email failed to send:', sendResult.error)
      await rollbackInvitedUser()
      return NextResponse.json(
        { error: 'We could not send the invitation email. Please try again.' },
        { status: 502 }
      )
    }

    return NextResponse.json({ 
      success: true,
      message: 'Invite sent successfully',
      user: invitedUser,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      )
    }
    console.error('[INVITES] Failed to send invitation:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
