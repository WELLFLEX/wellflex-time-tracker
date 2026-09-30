import { NextRequest, NextResponse } from 'next/server'
import { createServiceSupabaseClient } from '@/lib/supabase/server'
import { getUserFromRequest } from '@/lib/auth/get-user'
import { z } from 'zod'

const pendingInviteSchema = z.object({
  team_id: z.string().uuid(),
  role: z.enum(['MEMBER', 'MANAGER', 'ADMIN']),
  invited_by: z.string().uuid(),
  issued_at: z.string(),
})

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsedInvite = pendingInviteSchema.safeParse(
      user.app_metadata?.pending_team_invite
    )

    if (!parsedInvite.success) {
      return NextResponse.json(
        { error: 'This invitation is no longer valid or has already been accepted.' },
        { status: 400 }
      )
    }

    const invite = parsedInvite.data
    const supabase = createServiceSupabaseClient()

    // Ensure the profile row exists. A database trigger normally creates it when
    // the auth user is created, but this keeps invite acceptance resilient if the
    // trigger is unavailable or was added after the user was invited.
    const { data: existingProfile } = await supabase
      .from('users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()

    if (!existingProfile) {
      const { error: profileError } = await supabase.from('users').insert({
        id: user.id,
        email: user.email!,
        full_name: user.user_metadata?.full_name || null,
      } as any)

      if (profileError && !profileError.message.toLowerCase().includes('duplicate')) {
        return NextResponse.json(
          { error: 'Could not prepare your WeTrack profile.' },
          { status: 500 }
        )
      }
    }

    const { data: existingMember } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', invite.team_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!existingMember) {
      const { error: memberError } = await supabase
        .from('team_members')
        .insert({
          team_id: invite.team_id,
          user_id: user.id,
          role: invite.role,
        } as any)

      if (memberError && !memberError.message.toLowerCase().includes('duplicate')) {
        return NextResponse.json(
          { error: 'Could not add you to the invited team.' },
          { status: 500 }
        )
      }
    }

    // Consume the protected invite state after membership is established so the
    // same authorization payload cannot be replayed later.
    const { pending_team_invite: _pending, ...remainingAppMetadata } =
      user.app_metadata || {}

    const { error: metadataError } = await supabase.auth.admin.updateUserById(
      user.id,
      { app_metadata: remainingAppMetadata }
    )

    if (metadataError) {
      console.error('[INVITES] Failed to clear pending invite metadata:', metadataError.message)
      return NextResponse.json(
        { error: 'Your invite was accepted, but we could not finalize it safely. Please contact support.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      team_id: invite.team_id,
      role: invite.role,
    })
  } catch (error) {
    console.error('[INVITES] Failed to accept invitation:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
