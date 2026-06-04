"use client";

import { FormEvent, useState } from "react";
import { createOptionalBrowserClient } from "@/lib/supabase/client";

export default function SignInPage() {
  const [message, setMessage] = useState("Sign in to view owner-protected synchronized sessions.");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = createOptionalBrowserClient();
    if (!client) {
      setMessage("Supabase sync is not configured. Local paper sessions and the fixture demo remain available without sign-in.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const { error } = await client.auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setMessage(error ? error.message : "Signed in. Return to the console to receive worker updates.");
  }

  return (
    <section className="auth-page panel">
      <p className="eyebrow">Single Owner Access</p>
      <h1>Sign in</h1>
      <p className="muted">{message}</p>
      <form onSubmit={signIn}>
        <label>Email<input required name="email" type="email" /></label>
        <label>Password<input required name="password" type="password" /></label>
        <button className="primary" type="submit">Sign in</button>
      </form>
    </section>
  );
}
