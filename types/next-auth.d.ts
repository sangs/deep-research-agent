// Internal user id (users.id) carried in the Auth.js session token; see auth.ts.
import 'next-auth/jwt';

declare module 'next-auth/jwt' {
  interface JWT {
    uid?: string;
  }
}
