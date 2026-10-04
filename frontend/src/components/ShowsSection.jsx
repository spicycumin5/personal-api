import { Fragment, useState } from "react";

const emptyForm = (venues) => ({
  title: "",
  artist: "",
  date: "",
  venue_id: venues[0]?.id ?? "",
});

export default function ShowsSection({ shows, setShows, venues, runRequest }) {
  const [form, setForm] = useState(emptyForm(venues));
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [ticketsByShow, setTicketsByShow] = useState({});
  const [error, setError] = useState(null);

  const venueName = (id) => venues.find((v) => v.id === id)?.name ?? `#${id}`;

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    if (!form.title || !form.artist || !form.date || !form.venue_id) {
      setError("Title, artist, date, and venue are all required.");
      return;
    }
    const tx = await runRequest("POST", "/api/shows", "shows.create", {
      title: form.title,
      artist: form.artist,
      date: form.date,
      venue_id: Number(form.venue_id),
    });
    if (tx.ok) {
      setShows((prev) => [...prev, tx.responseBody]);
      setForm(emptyForm(venues));
    } else {
      setError(tx.responseBody?.error ?? "Something went wrong.");
    }
  }

  function startEdit(show) {
    setEditingId(show.id);
    setEditForm({ title: show.title, artist: show.artist, date: show.date, venue_id: show.venue_id });
  }

  async function saveEdit(id) {
    const tx = await runRequest("PUT", `/api/shows/${id}`, "shows.update", {
      title: editForm.title,
      artist: editForm.artist,
      date: editForm.date,
      venue_id: Number(editForm.venue_id),
    });
    if (tx.ok) {
      setShows((prev) => prev.map((s) => (s.id === id ? tx.responseBody : s)));
      setEditingId(null);
    } else {
      setError(tx.responseBody?.error ?? "Something went wrong.");
    }
  }

  async function handleDelete(id) {
    const tx = await runRequest("DELETE", `/api/shows/${id}`, "shows.delete");
    if (tx.ok) {
      setShows((prev) => prev.filter((s) => s.id !== id));
    } else {
      setError(tx.responseBody?.error ?? "Could not delete show.");
    }
  }

  async function toggleTickets(id) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    const tx = await runRequest("GET", `/api/shows/${id}/tickets`, "shows.tickets");
    if (tx.ok) {
      setTicketsByShow((prev) => ({ ...prev, [id]: tx.responseBody }));
    }
  }

  return (
    <div>
      <h2 className="section-title">Shows</h2>
      {error && <div className="error-banner">{error}</div>}

      <form className="form-row" onSubmit={handleCreate}>
        <div className="field">
          <label htmlFor="s-title">Title</label>
          <input id="s-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-artist">Artist</label>
          <input id="s-artist" value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-date">Date</label>
          <input id="s-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-venue">Venue</label>
          <select id="s-venue" value={form.venue_id} onChange={(e) => setForm({ ...form, venue_id: e.target.value })}>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" type="submit" disabled={venues.length === 0}>
          Add show
        </button>
      </form>
      {venues.length === 0 && <p style={{ color: "var(--paper-dim)" }}>Add a venue first.</p>}

      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Artist</th>
            <th>Date</th>
            <th>Venue</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {shows.length === 0 && (
            <tr className="empty-row">
              <td colSpan={6}>No shows booked yet.</td>
            </tr>
          )}
          {shows.map((show) =>
            editingId === show.id ? (
              <tr key={show.id}>
                <td>
                  <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
                </td>
                <td>
                  <input value={editForm.artist} onChange={(e) => setEditForm({ ...editForm, artist: e.target.value })} />
                </td>
                <td>
                  <input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} />
                </td>
                <td>
                  <select value={editForm.venue_id} onChange={(e) => setEditForm({ ...editForm, venue_id: e.target.value })}>
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td colSpan={2} className="actions-cell">
                  <button className="btn-quiet" onClick={() => saveEdit(show.id)}>
                    Save
                  </button>
                  <button className="btn-quiet" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </td>
              </tr>
            ) : (
              <Fragment key={show.id}>
                <tr>
                  <td>{show.title}</td>
                  <td>{show.artist}</td>
                  <td>{show.date}</td>
                  <td>{venueName(show.venue_id)}</td>
                  <td>
                    <button className="btn-quiet" onClick={() => toggleTickets(show.id)}>
                      {expandedId === show.id ? "Hide tickets" : "View tickets"}
                    </button>
                  </td>
                  <td className="actions-cell">
                    <button className="btn-quiet" onClick={() => startEdit(show)}>
                      Edit
                    </button>
                    <button className="btn-danger" onClick={() => handleDelete(show.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
                {expandedId === show.id && (
                  <tr>
                    <td colSpan={6} style={{ background: "rgba(255,255,255,0.02)" }}>
                      {!ticketsByShow[show.id] ? (
                        "Loading…"
                      ) : ticketsByShow[show.id].length === 0 ? (
                        "No tickets issued for this show yet."
                      ) : (
                        <span>
                          {ticketsByShow[show.id]
                            .map((t) => `${t.seat_section} ($${t.price}, ${t.status})`)
                            .join(" · ")}
                        </span>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
