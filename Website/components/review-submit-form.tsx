"use client";

import { useState, type FormEvent } from "react";
import type { ReviewErrors } from "@/lib/review";

type SubmitState =
  | { status: "idle"; message: string }
  | { status: "loading"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type ReviewResponse = {
  ok: boolean;
  message?: string;
  errors?: ReviewErrors;
};

export function ReviewSubmitForm() {
  const [state, setState] = useState<SubmitState>({ status: "idle", message: "" });
  const [errors, setErrors] = useState<ReviewErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setState({ status: "loading", message: "Review wordt verzonden..." });
    setErrors({});

    const payload = {
      name: String(data.get("name") ?? ""),
      club: String(data.get("club") ?? ""),
      role: String(data.get("role") ?? ""),
      rating: Number.parseInt(String(data.get("rating") ?? "5"), 10),
      quote: String(data.get("quote") ?? ""),
      website: String(data.get("website") ?? ""),
    };

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as ReviewResponse;
      if (!response.ok || !result.ok) {
        setErrors(result.errors ?? {});
        setState({
          status: "error",
          message: result.message ?? "Review kon niet worden verzonden.",
        });
        return;
      }

      form.reset();
      setState({
        status: "success",
        message: "Bedankt! Je review is ontvangen en verschijnt na goedkeuring.",
      });
    } catch {
      setState({
        status: "error",
        message: "Netwerkfout. Probeer later opnieuw.",
      });
    }
  }

  return (
    <form className="review-form" onSubmit={submit}>
      <div className="review-form-grid">
        <label>
          Naam
          <input name="name" type="text" placeholder="Je naam" aria-invalid={Boolean(errors.name)} required />
          {errors.name && <span>{errors.name}</span>}
        </label>
        <label>
          Club
          <input name="club" type="text" placeholder="Je club" aria-invalid={Boolean(errors.club)} required />
          {errors.club && <span>{errors.club}</span>}
        </label>
      </div>
      <div className="review-form-grid">
        <label>
          Functie (optioneel)
          <input name="role" type="text" placeholder="bv. Stadionspeaker" aria-invalid={Boolean(errors.role)} />
          {errors.role && <span>{errors.role}</span>}
        </label>
        <label>
          Score
          <select name="rating" defaultValue="5" aria-invalid={Boolean(errors.rating)} required>
            <option value="5">5 / 5</option>
            <option value="4">4 / 5</option>
            <option value="3">3 / 5</option>
            <option value="2">2 / 5</option>
            <option value="1">1 / 5</option>
          </select>
          {errors.rating && <span>{errors.rating}</span>}
        </label>
      </div>
      <label>
        Review
        <textarea
          name="quote"
          placeholder="Wat werkt voor jouw club met ArenaCue?"
          aria-invalid={Boolean(errors.quote)}
          required
        />
        {errors.quote && <span>{errors.quote}</span>}
      </label>
      <input className="honeypot" name="website" type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <button type="submit" disabled={state.status === "loading"}>
        {state.status === "loading" ? "Verzenden..." : "Review indienen"}
      </button>
      {state.message && <p className={`form-status ${state.status}`}>{state.message}</p>}
    </form>
  );
}
