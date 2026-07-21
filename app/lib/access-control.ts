import { getAccessRequest, createPendingAccessRequest, type AccessRequest } from '@/app/lib/access-requests';
import { sendAccessRequestNotification } from '@/app/lib/email';

export type AccessResolution =
  | { status: 'approved'; role: 'admin' | 'guest' }
  | { status: 'pending' }
  | { status: 'denied' };

// Shared by every non-guest-password sign-in path (Cognito email/password,
// Google OAuth, future providers): looks up the approval record for this
// email, creating a pending one (and notifying the admin) on first sign-in.
export async function resolveAccess(input: {
  email: string;
  name: string;
  provider: string;
  providerId: string;
}): Promise<AccessResolution> {
  let accessRequest: AccessRequest | null = await getAccessRequest(input.email);

  if (!accessRequest) {
    accessRequest = await createPendingAccessRequest(input);
    await sendAccessRequestNotification({ name: input.name, email: input.email, provider: input.provider });
  }

  if (accessRequest.status === 'approved') {
    return { status: 'approved', role: accessRequest.role };
  }
  if (accessRequest.status === 'denied') {
    return { status: 'denied' };
  }
  return { status: 'pending' };
}
