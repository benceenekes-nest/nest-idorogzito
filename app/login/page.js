"use client";
import { signIn } from "next-auth/react";
export default function Login(){
  return (
    <div className="wrap"><div className="center">
      <h1>NEST napi időrögzítő</h1>
      <p className="muted">Lépj be a céges Google-fiókoddal (@nestcom.hu).</p>
      <button className="btn" onClick={()=>signIn("google",{ callbackUrl:"/" })}>Belépés Google-fiókkal</button>
    </div></div>
  );
}
