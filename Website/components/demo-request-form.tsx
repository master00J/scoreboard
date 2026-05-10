"use client";

import { useState, type FormEvent } from "react";
import type { DemoRequestErrors } from "@/lib/demo-request";

type SubmitState =
  | { status: "idle"; message: string }
  | { status: "loading"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type DemoRequestResponse = {
  ok: boolean;
  message?: string;
  errors?: DemoRequestErrors;
};

export function DemoRequestForm() {
  const [state, setState] = useState<SubmitState>({
    status: "idle",
    message: "",
  });
  const [errors, setErrors] = useState<DemoRequestErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setState({ status: "loading", message: "Aanvraag wordt verzonden..." });
    setErrors({});

    const payload = {
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      club: String(data.get("club") ?? ""),
      phone: String(data.get("phone") ?? ""),
      message: String(data.get("message") ?? ""),
      website: String(data.get("website") ?? ""),
    };

    try {
      const response = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as DemoRequestResponse;

      if (!response.ok || !result.ok) {
        setErrors(result.errors ?? {});
        setState({
          status: "error",
          message: result.message ?? "Aanvraag kon niet worden verzonden.",
        });
        return;
      }

      form.reset();
      setState({
        status: "success",
        message: "Bedankt. We nemen zo snel mogelijk contact met je op.",
      });
    } catch {
      setState({
        status: "error",
        message: "Netwerkfout. Probeer later opnieuw.",
      });
    }
  }

  return (
    <form className="contact-form" onSubmit={submit}>
      <div className="demo-policy-note" role="note">
        <strong>Demo starten zonder gedoe</strong>
        <ul>
          <li>We voorzien één demo per e-mailadres en per apparaat, zodat elke testinstallatie overzichtelijk blijft.</li>
          <li>Na je demo helpen we je gewoon verder naar een volledige licentie op hetzelfde toestel.</li>
          <li>Twijfel je over de juiste pc of schermopstelling? Zet het in je bericht, dan kijken we mee.</li>
        </ul>
      </div>
      <div className="form-grid">
        <label>
          Naam
          <input
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Je naam"
            aria-invalid={Boolean(errors.name)}
            required
          />
          {errors.name && <span>{errors.name}</span>}
        </label>
        <label>
          E-mail
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="naam@club.be"
            aria-invalid={Boolean(errors.email)}
            required
          />
          {errors.email && <span>{errors.email}</span>}
        </label>
      </div>
      <label>
        Club / organisatie
        <input
          name="club"
          type="text"
          autoComplete="organization"
          placeholder="Naam van je club"
          aria-invalid={Boolean(errors.club)}
          required
        />
        {errors.club && <span>{errors.club}</span>}
      </label>
      <label>
        Telefoon (optioneel)
        <input
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+32 ..."
          aria-invalid={Boolean(errors.phone)}
        />
        {errors.phone && <span>{errors.phone}</span>}
      </label>
      <label>
        Bericht
        <textarea
          name="message"
          placeholder="Vertel kort welke schermopstelling of timing je voor ogen hebt."
          aria-invalid={Boolean(errors.message)}
        />
        {errors.message && <span>{errors.message}</span>}
      </label>
      <input
        className="honeypot"
        name="website"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <button type="submit" disabled={state.status === "loading"}>
        {state.status === "loading" ? "Verzenden..." : "Demo aanvragen"}
      </button>
      {state.message && (
        <p className={`form-status ${state.status}`}>{state.message}</p>
      )}
    </form>
  );
}
