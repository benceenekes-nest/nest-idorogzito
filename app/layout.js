import "./globals.css";
import Providers from "./providers";
export const metadata = { title: "NEST időrögzítő", description: "NEST napi időrögzítő" };
export default function RootLayout({ children }){
  return (<html lang="hu"><body><Providers>{children}</Providers></body></html>);
}
