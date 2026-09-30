import nodemailer from 'nodemailer'

export type RequestEmailMeta = {
  submittedForName?: string
  submittedForEmail?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Create transporter using environment variables (same SMTP as Supabase)
const getEmailTransporter = () => {
  const smtpHost = process.env.SMTP_HOST
  const smtpPort = process.env.SMTP_PORT
  const smtpUser = process.env.SMTP_USER
  const smtpPassword = process.env.SMTP_PASSWORD
  const smtpFromEmail = process.env.SMTP_FROM_EMAIL || 'wetrack <noreply@wellflex.co>'

  console.log('[EMAIL] Checking SMTP configuration:', {
    hasHost: !!smtpHost,
    hasPort: !!smtpPort,
    hasUser: !!smtpUser,
    hasPassword: !!smtpPassword,
    fromEmail: smtpFromEmail
  })

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPassword) {
    console.error('[EMAIL] ❌ SMTP not fully configured:', {
      missing: {
        host: !smtpHost,
        port: !smtpPort,
        user: !smtpUser,
        password: !smtpPassword
      }
    })
    return null
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort),
      secure: smtpPort === '465', // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
    })
    
    console.log('[EMAIL] ✅ SMTP transporter created successfully')
    return transporter
  } catch (error: any) {
    console.error('[EMAIL] ❌ Failed to create SMTP transporter:', {
      error: error?.message || error,
      stack: error?.stack
    })
    return null
  }
}

export async function sendRequestNotificationEmail(
  requestType: string,
  userName: string,
  userEmail: string,
  teamName: string,
  description: string,
  requestedDateFrom?: string,
  requestedDateTo?: string,
  requestedTimeFrom?: string,
  requestedTimeTo?: string,
  recipientEmails: string[] = [],
  meta?: RequestEmailMeta
) {
  console.log('[EMAIL] Starting notification email send', {
    requestType,
    userName,
    userEmail,
    teamName,
    hasSmtpConfig: !!(process.env.SMTP_HOST && process.env.SMTP_USER)
  })
  
  const transporter = getEmailTransporter()
  if (!transporter) {
    console.error('[EMAIL] SMTP not configured, skipping email notification')
    return
  }

  const timeInfo = requestedTimeFrom && requestedTimeTo
    ? `${requestedTimeFrom} - ${requestedTimeTo}`
    : requestedTimeFrom || requestedTimeTo || null

  let dateInfo = 'N/A'
  if (requestedDateFrom && requestedDateTo) {
    const fromDate = new Date(requestedDateFrom + 'T00:00:00')
    const toDate = new Date(requestedDateTo + 'T00:00:00')
    const fromStr = fromDate.toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: fromDate.getFullYear() !== toDate.getFullYear() ? 'numeric' : undefined 
    })
    const toStr = toDate.toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    })
    dateInfo = fromDate.getTime() === toDate.getTime() ? fromStr : `${fromStr} - ${toStr}`
  } else if (requestedDateFrom) {
    dateInfo = new Date(requestedDateFrom + 'T00:00:00').toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    })
  }

  const safeType = escapeHtml(requestType)
  const safeName = escapeHtml(userName)
  const safeEmail = escapeHtml(userEmail)
  const safeTeam = escapeHtml(teamName)
  const safeDesc = escapeHtml(description)
  const forName = meta?.submittedForName ? escapeHtml(meta.submittedForName) : ''
  const forEmail = meta?.submittedForEmail ? escapeHtml(meta.submittedForEmail) : ''

  if (!recipientEmails.length) {
    console.warn('[EMAIL] No request notification recipients; skipping admin notification')
    return
  }

  const subject = `New ${requestType} Request from ${userName}`
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Request Notification</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">New Request Submitted</h1>
        </div>
        
        <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e9ecef; border-top: none;">
          <p style="font-size: 16px; margin-top: 0;">A new request has been submitted and requires your review.</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #495057; width: 140px;">Request Type:</td>
                <td style="padding: 8px 0; color: #212529;">${safeType}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Submitted By:</td>
                <td style="padding: 8px 0; color: #212529;">${safeName} (${safeEmail})</td>
              </tr>
              ${forName ? `
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">For:</td>
                <td style="padding: 8px 0; color: #212529;">${forName}${forEmail ? ` (${forEmail})` : ''}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Team:</td>
                <td style="padding: 8px 0; color: #212529;">${safeTeam}</td>
              </tr>
              ${dateInfo !== 'N/A' ? `
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Date Range:</td>
                <td style="padding: 8px 0; color: #212529;">${dateInfo}</td>
              </tr>
              ` : ''}
              ${timeInfo ? `
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Time Range:</td>
                <td style="padding: 8px 0; color: #212529;">${timeInfo}</td>
              </tr>
              ` : ''}
            </table>
          </div>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <p style="margin: 0; font-weight: bold; color: #495057; margin-bottom: 8px;">Description:</p>
            <p style="margin: 0; color: #212529; white-space: pre-wrap;">${safeDesc}</p>
          </div>
          
          <p style="font-size: 14px; color: #6c757d; margin-top: 30px;">
            Please review this request in the admin panel.
          </p>
        </div>
        
        <div style="text-align: center; margin-top: 20px; color: #6c757d; font-size: 12px;">
          <p>This is an automated notification from wetrack</p>
        </div>
      </body>
    </html>
  `

  const forPlain =
    meta?.submittedForName != null && meta.submittedForName !== ''
      ? `For: ${meta.submittedForName}${meta.submittedForEmail ? ` (${meta.submittedForEmail})` : ''}\n`
      : ''

  const textContent = `
New Request Submitted

A new request has been submitted and requires your review.

Request Type: ${requestType}
Submitted By: ${userName} (${userEmail})
${forPlain}Team: ${teamName}
${dateInfo !== 'N/A' ? `Date Range: ${dateInfo}` : ''}
${timeInfo ? `Time Range: ${timeInfo}` : ''}

Description:
${description}

Please review this request in the admin panel.
  `.trim()

  try {
    const fromEmail = process.env.SMTP_FROM_EMAIL || 'wetrack <noreply@wellflex.co>'
    console.log('[EMAIL] Attempting to send notification emails', {
      from: fromEmail,
      to: recipientEmails,
      count: recipientEmails.length
    })

    const emailPromises = recipientEmails.map(async (email) => {
      try {
        const result = await transporter.sendMail({
          from: fromEmail,
          to: email,
          subject,
          html: htmlContent,
          text: textContent,
        })
        console.log('[EMAIL] ✅ Email sent to', email, { messageId: result.messageId })
        return result
      } catch (emailError: any) {
        console.error('[EMAIL] ❌ Failed to send to', email, {
          error: emailError?.message || emailError,
          code: emailError?.code,
          response: emailError?.response
        })
        throw emailError
      }
    })

    const results = await Promise.all(emailPromises)
    console.log('[EMAIL] ✅ All notification emails sent successfully', {
      sent: results.length,
      emails: recipientEmails,
      messageIds: results.map((r: any) => r.messageId)
    })
  } catch (error: any) {
    console.error('[EMAIL] ❌ Failed to send request notification email:', {
      error: error?.message || error,
      stack: error?.stack,
      code: error?.code,
      response: error?.response,
      command: error?.command
    })
    // Don't throw - we don't want email failures to break request creation
  }
}

export async function sendRequestConfirmationEmail(
  requestType: string,
  userName: string,
  userEmail: string,
  teamName: string,
  description: string,
  requestedDateFrom?: string,
  requestedDateTo?: string,
  requestedTimeFrom?: string,
  requestedTimeTo?: string,
  meta?: RequestEmailMeta
) {
  console.log('[EMAIL] Starting confirmation email send', {
    requestType,
    userName,
    userEmail,
    teamName,
    hasSmtpConfig: !!(process.env.SMTP_HOST && process.env.SMTP_USER)
  })
  
  const transporter = getEmailTransporter()
  if (!transporter) {
    console.error('[EMAIL] SMTP not configured, skipping confirmation email')
    return
  }

  const timeInfo = requestedTimeFrom && requestedTimeTo
    ? `${requestedTimeFrom} - ${requestedTimeTo}`
    : requestedTimeFrom || requestedTimeTo || null

  let dateInfo = 'N/A'
  if (requestedDateFrom && requestedDateTo) {
    const fromDate = new Date(requestedDateFrom + 'T00:00:00')
    const toDate = new Date(requestedDateTo + 'T00:00:00')
    const fromStr = fromDate.toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: fromDate.getFullYear() !== toDate.getFullYear() ? 'numeric' : undefined 
    })
    const toStr = toDate.toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    })
    dateInfo = fromDate.getTime() === toDate.getTime() ? fromStr : `${fromStr} - ${toStr}`
  } else if (requestedDateFrom) {
    dateInfo = new Date(requestedDateFrom + 'T00:00:00').toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    })
  }

  const safeType = escapeHtml(requestType)
  const safeName = escapeHtml(userName)
  const safeTeam = escapeHtml(teamName)
  const safeDesc = escapeHtml(description)
  const forName = meta?.submittedForName ? escapeHtml(meta.submittedForName) : ''
  const forEmail = meta?.submittedForEmail ? escapeHtml(meta.submittedForEmail) : ''

  const subject = `Your ${requestType} Request Has Been Submitted`
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Request Confirmation</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Request Submitted Successfully</h1>
        </div>
        
        <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e9ecef; border-top: none;">
          <p style="font-size: 16px; margin-top: 0;">Hi ${safeName},</p>
          
          <p style="font-size: 16px;">Thank you for submitting your request. We've received it and it's now pending review by an administrator.</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #495057; width: 140px;">Request Type:</td>
                <td style="padding: 8px 0; color: #212529;">${safeType}</td>
              </tr>
              ${forName ? `
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Applies to:</td>
                <td style="padding: 8px 0; color: #212529;">${forName}${forEmail ? ` (${forEmail})` : ''}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Team:</td>
                <td style="padding: 8px 0; color: #212529;">${safeTeam}</td>
              </tr>
              ${dateInfo !== 'N/A' ? `
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Date Range:</td>
                <td style="padding: 8px 0; color: #212529;">${dateInfo}</td>
              </tr>
              ` : ''}
              ${timeInfo ? `
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #495057;">Time Range:</td>
                <td style="padding: 8px 0; color: #212529;">${timeInfo}</td>
              </tr>
              ` : ''}
            </table>
          </div>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <p style="margin: 0; font-weight: bold; color: #495057; margin-bottom: 8px;">Your Description:</p>
            <p style="margin: 0; color: #212529; white-space: pre-wrap;">${safeDesc}</p>
          </div>
          
          <div style="background: #e7f3ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2196F3;">
            <p style="margin: 0; font-size: 14px; color: #1976D2;">
              <strong>Status:</strong> Pending Review
            </p>
            <p style="margin: 8px 0 0 0; font-size: 14px; color: #1976D2;">
              You'll receive another email once your request has been reviewed.
            </p>
          </div>
          
          <p style="font-size: 14px; color: #6c757d; margin-top: 30px;">
            If you have any questions, please contact your team administrator.
          </p>
        </div>
        
        <div style="text-align: center; margin-top: 20px; color: #6c757d; font-size: 12px;">
          <p>This is an automated confirmation from wetrack</p>
        </div>
      </body>
    </html>
  `

  const appliesPlain =
    meta?.submittedForName != null && meta.submittedForName !== ''
      ? `Applies to: ${meta.submittedForName}${meta.submittedForEmail ? ` (${meta.submittedForEmail})` : ''}\n`
      : ''

  const textContent = `
Request Submitted Successfully

Hi ${userName},

Thank you for submitting your request. We've received it and it's now pending review by an administrator.

Request Type: ${requestType}
${appliesPlain}Team: ${teamName}
${dateInfo !== 'N/A' ? `Date Range: ${dateInfo}` : ''}
${timeInfo ? `Time Range: ${timeInfo}` : ''}

Your Description:
${description}

Status: Pending Review
You'll receive another email once your request has been reviewed.

If you have any questions, please contact your team administrator.
  `.trim()

  try {
    const fromEmail = process.env.SMTP_FROM_EMAIL || 'wetrack <noreply@wellflex.co>'
    console.log('[EMAIL] Attempting to send confirmation email', {
      from: fromEmail,
      to: userEmail
    })

    const result = await transporter.sendMail({
      from: fromEmail,
      to: userEmail,
      subject,
      html: htmlContent,
      text: textContent,
    })
    console.log('[EMAIL] ✅ Confirmation email sent successfully to requester', {
      email: userEmail,
      messageId: result.messageId
    })
  } catch (error: any) {
    console.error('[EMAIL] ❌ Failed to send request confirmation email:', {
      error: error?.message || error,
      stack: error?.stack,
      code: error?.code,
      response: error?.response,
      command: error?.command,
      email: userEmail
    })
    // Don't throw - we don't want email failures to break request creation
  }
}

type AuthEmailResult = { success: boolean; error?: string }

function buildAuthEmailHtml(params: {
  heading: string
  intro: string
  buttonLabel: string
  actionUrl: string
  footerNote: string
}): string {
  const safeUrl = escapeHtml(params.actionUrl)
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(params.heading)}</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Wellflex</h1>
        </div>
        <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e9ecef; border-top: none;">
          <h2 style="margin-top: 0; color: #212529;">${escapeHtml(params.heading)}</h2>
          <p style="font-size: 16px;">${escapeHtml(params.intro)}</p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${safeUrl}" style="background: #4f46e5; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: bold; display: inline-block;">${escapeHtml(params.buttonLabel)}</a>
          </div>
          <p style="font-size: 13px; color: #6c757d;">Or copy and paste this link into your browser:</p>
          <p style="font-size: 13px; word-break: break-all;"><a href="${safeUrl}">${safeUrl}</a></p>
          <p style="font-size: 13px; color: #6c757d; margin-top: 24px;">${escapeHtml(params.footerNote)}</p>
        </div>
      </body>
    </html>
  `.trim()
}

/**
 * Send the account-confirmation email through our own SMTP (Zoho). The link is
 * an app-hosted /auth/confirm URL carrying the token_hash, so the whole link
 * stays on the app domain and clicking it verifies + signs the user in.
 */
export async function sendAuthConfirmationEmail(params: {
  to: string
  name?: string | null
  confirmUrl: string
}): Promise<AuthEmailResult> {
  const transporter = getEmailTransporter()
  if (!transporter) {
    console.error('[EMAIL] SMTP not configured; cannot send confirmation email')
    return { success: false, error: 'SMTP not configured' }
  }

  const fromEmail = process.env.SMTP_FROM_EMAIL || 'wetrack <noreply@wellflex.co>'
  const greetingName = params.name || 'there'
  const html = buildAuthEmailHtml({
    heading: 'Confirm your email',
    intro: `Hi ${greetingName}, welcome to Wellflex! Click the button below to confirm your email and sign in.`,
    buttonLabel: 'Confirm my email',
    actionUrl: params.confirmUrl,
    footerNote: 'This link expires in 24 hours. If you did not create an account, you can ignore this email.',
  })

  try {
    const result = await transporter.sendMail({
      from: fromEmail,
      to: params.to,
      subject: 'Confirm your Wellflex account',
      html,
    })
    console.log('[EMAIL] ✅ Confirmation email sent', { to: params.to, messageId: result.messageId })
    return { success: true }
  } catch (error: any) {
    console.error('[EMAIL] ❌ Failed to send confirmation email:', { error: error?.message || error, to: params.to })
    return { success: false, error: error?.message || 'Failed to send confirmation email' }
  }
}

/**
 * Send the password-reset email through our own SMTP (Zoho). The link is an
 * app-hosted /reset-password URL carrying the recovery token_hash.
 */
export async function sendPasswordResetEmail(params: {
  to: string
  resetUrl: string
}): Promise<AuthEmailResult> {
  const transporter = getEmailTransporter()
  if (!transporter) {
    console.error('[EMAIL] SMTP not configured; cannot send password reset email')
    return { success: false, error: 'SMTP not configured' }
  }

  const fromEmail = process.env.SMTP_FROM_EMAIL || 'wetrack <noreply@wellflex.co>'
  const html = buildAuthEmailHtml({
    heading: 'Reset your password',
    intro: 'We received a request to reset your Wellflex password. Click the button below to choose a new one.',
    buttonLabel: 'Reset password',
    actionUrl: params.resetUrl,
    footerNote: 'This link expires in 24 hours. If you did not request a password reset, you can safely ignore this email.',
  })

  try {
    const result = await transporter.sendMail({
      from: fromEmail,
      to: params.to,
      subject: 'Reset your Wellflex password',
      html,
    })
    console.log('[EMAIL] ✅ Password reset email sent', { to: params.to, messageId: result.messageId })
    return { success: true }
  } catch (error: any) {
    console.error('[EMAIL] ❌ Failed to send password reset email:', { error: error?.message || error, to: params.to })
    return { success: false, error: error?.message || 'Failed to send password reset email' }
  }
}

/**
 * Send a team invitation through WeTrack's own SMTP. The action URL is hosted
 * by the app so email scanners do not hit Supabase's one-time /verify endpoint.
 */
export async function sendTeamInviteEmail(params: {
  to: string
  inviteUrl: string
  teamName?: string | null
  role: 'MEMBER' | 'MANAGER' | 'ADMIN'
}): Promise<AuthEmailResult> {
  const transporter = getEmailTransporter()
  if (!transporter) {
    console.error('[EMAIL] SMTP not configured; cannot send team invitation')
    return { success: false, error: 'SMTP not configured' }
  }

  const fromEmail = process.env.SMTP_FROM_EMAIL || 'wetrack <noreply@wellflex.co>'
  const teamLabel = params.teamName ? ` to ${params.teamName}` : ''
  const roleLabel =
    params.role === 'ADMIN' ? 'an administrator' :
    params.role === 'MANAGER' ? 'a manager' :
    'a member'

  const html = buildAuthEmailHtml({
    heading: 'You are invited to WeTrack',
    intro: `You have been invited${teamLabel} as ${roleLabel}. Click the button below to review and accept the invitation.`,
    buttonLabel: 'Review invitation',
    actionUrl: params.inviteUrl,
    footerNote: 'For your security, the invitation is completed only after you click Accept on the WeTrack page. If you were not expecting this invitation, you can ignore this email.',
  })

  try {
    const result = await transporter.sendMail({
      from: fromEmail,
      to: params.to,
      subject: params.teamName
        ? `You are invited to ${params.teamName} on WeTrack`
        : 'You are invited to WeTrack',
      html,
    })
    console.log('[EMAIL] ✅ Team invitation sent', { to: params.to, messageId: result.messageId })
    return { success: true }
  } catch (error: any) {
    console.error('[EMAIL] ❌ Failed to send team invitation:', {
      error: error?.message || error,
      to: params.to,
    })
    return { success: false, error: error?.message || 'Failed to send team invitation' }
  }
}

