'use client'

import { Suspense, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

type Status = 'ready' | 'accepting' | 'success' | 'error'

function AcceptInviteContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<Status>('ready')
  const [error, setError] = useState('')

  const invite = useMemo(() => {
    const tokenHash = searchParams.get('token_hash')
    const type = searchParams.get('type')

    if (!tokenHash || type !== 'invite') return null
    return { tokenHash, type: 'invite' as const }
  }, [searchParams])

  const acceptInvite = async () => {
    if (!invite || status === 'accepting') {
      if (!invite) {
        setStatus('error')
        setError('This invitation link is incomplete or invalid.')
      }
      return
    }

    setStatus('accepting')
    setError('')

    try {
      const supabase = createClient()

      // Only consume the one-time Supabase token after a real user explicitly
      // accepts the invitation. Merely opening/prefetching this page is harmless.
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        type: invite.type,
        token_hash: invite.tokenHash,
      })

      if (verifyError || !data.session) {
        throw new Error(
          verifyError?.message ||
            'This invitation has expired or was already used. Ask your administrator for a new invitation.'
        )
      }

      // Team/role assignment happens on the server from protected app_metadata.
      // The browser supplies only the authenticated session proving who accepted.
      const response = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
        },
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to accept invitation')
      }

      setStatus('success')
      router.replace('/dashboard')
      router.refresh()
    } catch (err: any) {
      setStatus('error')
      setError(err?.message || 'Failed to accept invitation')
    }
  }

  const invalid = !invite

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full p-8 bg-white rounded-2xl shadow-sm border border-gray-100">
        {status === 'success' ? (
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="mt-6 text-2xl font-bold text-gray-900">Invitation accepted</h1>
            <p className="mt-2 text-sm text-gray-600">Taking you to WeTrack…</p>
          </div>
        ) : status === 'error' || invalid ? (
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="mt-6 text-2xl font-bold text-gray-900">Invitation unavailable</h1>
            <p className="mt-2 text-sm text-gray-600">
              {error || 'This invitation link is incomplete or invalid.'}
            </p>
            <a
              href="/login"
              className="mt-6 inline-flex text-sm font-semibold text-indigo-600 hover:text-indigo-500"
            >
              Go to login
            </a>
          </div>
        ) : (
          <div className="text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100">
              <svg className="h-6 w-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 8a3 3 0 00-3-3H9a3 3 0 00-3 3v8a3 3 0 003 3h6a3 3 0 003-3V8zM9 5V3m6 2V3" />
              </svg>
            </div>
            <h1 className="mt-6 text-2xl font-bold text-gray-900">Join your team on WeTrack</h1>
            <p className="mt-2 text-sm text-gray-600">
              Your invitation is ready. Accept it to sign in and join the team you were invited to.
            </p>
            <button
              type="button"
              onClick={acceptInvite}
              disabled={status === 'accepting'}
              className="mt-8 w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === 'accepting' ? 'Accepting invitation…' : 'Accept invitation'}
            </button>
            <p className="mt-4 text-xs text-gray-500">
              The invitation is only activated after you press the button above.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <p className="text-sm text-gray-600">Loading invitation…</p>
        </div>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  )
}
