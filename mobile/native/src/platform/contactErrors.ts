export type ContactFailure = 'permission' | 'limited' | 'unavailable' | 'readFailed' | 'noNumber';

// Keep native error details and contact data out of user-facing errors.
export class ContactLookupError extends Error {
  readonly reason: ContactFailure;
  constructor(reason: ContactFailure) {
    super(`contacts_${reason}`);
    this.reason = reason;
  }
}
