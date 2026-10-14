"use client";

import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "@/lib/neonAuthClient";

interface UserFile {
  id: string;
  name: string;
  size: number;
  createdAt: string;
}

type AuthMode = "sign-in" | "sign-up";

async function responseError(response: Response): Promise<string> {
  const result = (await response.json()) as { error?: string };
  return result.error ?? `Anfrage fehlgeschlagen (${response.status}).`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unbekannter Fehler.";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AccountFiles() {
  const { data: session, isPending } = authClient.useSession();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [files, setFiles] = useState<UserFile[]>([]);
  const [filesOwnerId, setFilesOwnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const userId = session?.user?.id;
  const currentFiles = filesOwnerId === userId ? files : [];
  const filesPending = Boolean(userId && filesOwnerId !== userId);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    void fetch("/api/files", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return (await response.json()) as { files: UserFile[] };
      })
      .then((result) => {
        if (!cancelled) {
          setFiles(result.files);
          setFilesOwnerId(userId);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorText(cause));
      })

    return () => {
      cancelled = true;
    };
  }, [userId, reload]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email({ email, password, name: email.split("@")[0] })
          : await authClient.signIn.email({ email, password });
      if (result.error) throw new Error(result.error.message);
      setMessage(mode === "sign-up" ? "Konto erstellt." : "Angemeldet.");
      setPassword("");
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submitFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/files", { method: "POST", body: new FormData(form) });
      if (!response.ok) throw new Error(await responseError(response));
      form.reset();
      setMessage("Datei privat gespeichert.");
      setReload((value) => value + 1);
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message);
      setMessage("Abgemeldet.");
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  if (isPending) {
    return <p className="account-status" role="status">Anmeldestatus wird geladen …</p>;
  }

  return (
    <div className="account">
      {error && <p className="account-message account-message--error" role="alert">{error}</p>}
      {message && <p className="account-message" role="status">{message}</p>}

      {session?.user ? (
        <div className="account-panel">
          <div className="account-panel__head">
            <div>
              <h2 className="t-3">Deine Dateien</h2>
              <p className="muted">Angemeldet als {session.user.email}</p>
            </div>
            <button className="btn btn--small" type="button" onClick={signOut} disabled={busy}>
              Abmelden
            </button>
          </div>
          <form className="account-form" onSubmit={submitFile}>
            <label>
              Datei auswählen (max. 10 MiB)
              <input name="file" type="file" required disabled={busy} />
            </label>
            <button className="btn" type="submit" disabled={busy}>Datei hochladen</button>
          </form>
          {filesPending ? (
            <p className="account-status" role="status">
              {error ? "Dateiliste nicht verfügbar." : "Dateien werden geladen …"}
            </p>
          ) : files.length ? (
            <ul className="account-files">
              {currentFiles.map((file) => (
                <li key={file.id}>
                  <a href={`/api/files/${encodeURIComponent(file.id)}`}>{file.name}</a>
                  <span className="muted">{formatSize(file.size)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="account-status">Noch keine Dateien hochgeladen.</p>
          )}
        </div>
      ) : (
        <div className="account-panel">
          <div className="account-panel__head">
            <h2 className="t-3">{mode === "sign-in" ? "Anmelden" : "Konto erstellen"}</h2>
            <button
              className="btn btn--small"
              type="button"
              onClick={() => {
                setMode(mode === "sign-in" ? "sign-up" : "sign-in");
                setError("");
                setMessage("");
              }}
            >
              {mode === "sign-in" ? "Registrieren" : "Zum Login"}
            </button>
          </div>
          <form className="account-form" onSubmit={submitAuth}>
            <label>
              E-Mail
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <label>
              Passwort
              <input
                type="password"
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            <button className="btn" type="submit" disabled={busy}>
              {mode === "sign-up" ? "Konto erstellen" : "Anmelden"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
