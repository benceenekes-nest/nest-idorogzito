import GoogleProvider from "next-auth/providers/google";

const MANAGERS = (process.env.MANAGER_EMAILS||"")
  .split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
const ALLOWED = (process.env.ALLOWED_DOMAIN||"nestcom.hu").toLowerCase();

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { hd: ALLOWED, prompt: "select_account" } }
    })
  ],
  session: { strategy: "jwt" },
  // Közös munkamenet az ido.* és menedzsment.* aldoméneken.
  cookies: process.env.COOKIE_DOMAIN ? {
    sessionToken: {
      name: "__Secure-next-auth.session-token",
      options: { httpOnly:true, sameSite:"lax", path:"/", secure:true, domain: process.env.COOKIE_DOMAIN }
    }
  } : undefined,
  callbacks: {
    // csak a céges domain léphet be
    async signIn({ profile, user }){
      const email = (profile?.email || user?.email || "").toLowerCase();
      return email.endsWith("@"+ALLOWED);
    },
    async jwt({ token }){
      const email = (token.email||"").toLowerCase();
      token.isManager = MANAGERS.includes(email);
      return token;
    },
    async redirect({ url, baseUrl }){
      try{
        const u = new URL(url, baseUrl);
        if(u.hostname === new URL(baseUrl).hostname) return u.toString();
        if(u.hostname.endsWith(".nestgroup.hu")) return u.toString();
      }catch(e){}
      return baseUrl;
    },
    async session({ session, token }){
      session.user.email = (token.email||"").toLowerCase();
      session.user.isManager = !!token.isManager;
      return session;
    }
  },
  pages: { signIn: "/login" }
};

export function isManagerEmail(email){
  return MANAGERS.includes((email||"").toLowerCase());
}
