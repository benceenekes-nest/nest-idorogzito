export { default } from "next-auth/middleware";
// minden védett útvonal: főoldal, riport, api (kivéve auth)
export const config = {
  matcher: ["/", "/report", "/api/tasks/:path*", "/api/time/:path*", "/api/report/:path*"]
};
