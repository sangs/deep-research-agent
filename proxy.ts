// Next.js 16 proxy (formerly middleware): every page and API route requires an
// allowlisted Google sign-in, except the Auth.js routes themselves and static
// assets. Decision logic lives in the `authorized` callback in auth.ts.
export { auth as proxy } from '@/auth';

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
