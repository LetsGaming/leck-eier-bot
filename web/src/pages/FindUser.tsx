import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../components/ToastContext";
import type { MemberSearchResult } from "../types";

const DEBOUNCE_MS = 300;

export default function FindUser() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const { showError } = useToast();

  const trimmed = query.trim();

  useEffect(() => {
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .searchMembers(trimmed)
        .then(setResults)
        .catch((err) => showError(errorMessage(err)))
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, showError]);

  return (
    <div>
      <h2>Find User</h2>
      <p className="muted">
        Every cached guild member, or search by username, global name, nickname, or display name — same matching as{" "}
        <code>/finduser</code> (handles stylized/lookalike Unicode names too).
      </p>

      <div className="card">
        <div className="field">
          <label htmlFor="find-user-query">Name</label>
          <input
            id="find-user-query"
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Start typing a name…"
          />
        </div>

        {searching && <div className="loading">Searching…</div>}

        {!searching && results && results.length === 0 && (
          <p className="muted">{trimmed ? `No members found matching "${trimmed}".` : "No cached members yet."}</p>
        )}

        {!searching && results && results.length > 0 && (
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Display name</th>
                <th>Username</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {results.map((m) => (
                <tr key={m.id}>
                  <td>
                    <img src={m.avatarUrl} alt="" width={28} height={28} style={{ borderRadius: "50%" }} />
                  </td>
                  <td>{m.displayName}</td>
                  <td className="muted">{m.tag}</td>
                  <td className="muted">
                    <code>{m.id}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
