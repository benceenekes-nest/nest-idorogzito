import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// A menedzsment.nestgroup.hu a vezetői felületet szolgálja ki a gyökéren.
const MGMT = "menedzsment.";

export async function middleware(req){
  const host = (req.headers.get("host")||"").toLowerCase();
  const { pathname } = req.nextUrl;
  const isMgmt = host.startsWith(MGMT);

  // NextAuth és statikus fájlok mindig átmennek
  if(pathname.startsWith("/api/auth") || pathname.startsWith("/_next") || pathname==="/nest-logo.svg"){
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if(isMgmt){
    if(pathname === "/" || pathname === "/vezetoi"){
      if(!token) return NextResponse.next();          // a lap maga kínálja a belépést
      if(!token.isManager) return new NextResponse("Ehhez vezetői jogosultság kell.", { status:403 });
      if(pathname === "/") return NextResponse.rewrite(new URL("/vezetoi", req.url));
      return NextResponse.next();
    }
    if(pathname.startsWith("/api/vezetoi")) return NextResponse.next();   // az API maga ellenőriz
    // minden más útvonalat a menedzsment hoszton a gyökérre viszünk
    return NextResponse.redirect(new URL("/", req.url));
  }

  // ido.nestgroup.hu — védett útvonalak
  const guarded = ["/", "/report", "/szabadsag", "/api/tasks", "/api/time", "/api/report", "/api/leave"];
  if(guarded.some(p=> pathname===p || pathname.startsWith(p+"/"))){
    if(!token){
      const url = new URL("/login", req.url);
      return NextResponse.redirect(url);
    }
  }
  if(pathname==="/vezetoi" && (!token || !token.isManager)){
    return new NextResponse("Ehhez vezetői jogosultság kell.", { status:403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
