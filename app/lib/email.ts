import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });

export async function sendAccessRequestNotification(input: {
  name: string;
  email: string;
  provider: string;
}): Promise<void> {
  const from = process.env.SES_FROM_EMAIL;
  const to = process.env.ACCESS_REQUEST_NOTIFY_EMAIL;
  // Notifying the admin is best-effort — the request is already recorded and
  // visible in /admin either way, so a missing config or SES failure here
  // shouldn't block the sign-in flow.
  if (!from || !to) return;

  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: `Hawaii Gallery: access request from ${input.name}` },
          Body: {
            Text: {
              Data: `${input.name} (${input.email}) is requesting guest access to the Hawaii Gallery via ${input.provider}.\n\nApprove or deny at https://hawaii.daveneti.photos/admin`,
            },
          },
        },
      })
    );
  } catch (error) {
    console.error('Failed to send access request notification email', error);
  }
}
