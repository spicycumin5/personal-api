import { useState } from "react";

const emptyForm = (shows) => ({
  seat_section: "",
  price: "",
  status: "available",
  show_id: shows[0]?.id ?? "",
});

export default function TicketsSection({ tickets, setTickets, shows, runRequest }) {
  const [form, setForm] = useState(emptyForm(shows));
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [error, setError] = useState(null);

  const showTitle = (id) => shows.find((s) => s.id === id)?.title ?? `#${id}`;

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    if (!form.seat_section || !form.price || !form.show_id) {
      setError("Seat section, price, and show are all required.");
      return;
    }
    const tx = await runRequest("POST", "/api/tickets", "tickets.create", {
      seat_section: form.seat_section,
      price: Number(form.price),
      status: form.status,
      show_id: Number(form.show_id),
    });
    if (tx.ok) {
      setTickets((prev) => [...prev, tx.responseBody]);
      setForm(emptyForm(shows));
    } else {
      setError(tx.responseBody?.error ?? "Something went wrong.");
    }
  }

  function startEdit(ticket) {
    setEditingId(ticket.id);
    setEditForm({
      seat_section: ticket.seat_section,
      price: String(ticket.price),
      status: ticket.status,
      show_id: ticket.show_id,
      buyer_name: ticket.buyer_name ?? "",
    });
  }

  // Full replace: every field is sent, matching PUT semantics.
  async function saveEdit(id) {
    const tx = await runRequest("PUT", `/api/tickets/${id}`, "tickets.put", {
      seat_section: editForm.seat_section,
      price: Number(editForm.price),
      status: editForm.status,
      show_id: Number(editForm.show_id),
      buyer_name: editForm.buyer_name || null,
    });
    if (tx.ok) {
      setTickets((prev) => prev.map((t) => (t.id === id ? tx.responseBody : t)));
      setEditingId(null);
    } else {
      setError(tx.responseBody?.error ?? "Something went wrong.");
    }
  }

  // Partial update: only the status (and buyer when selling) is sent, matching PATCH semantics.
  async function toggleSold(ticket) {
    const body =
      ticket.status === "available"
        ? { status: "sold", buyer_name: "Walk-up buyer" }
        : { status: "available", buyer_name: null };
    const tx = await runRequest("PATCH", `/api/tickets/${ticket.id}`, "tickets.patch", body);
    if (tx.ok) {
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? tx.responseBody : t)));
    } else {
      setError(tx.responseBody?.error ?? "Something went wrong.");
    }
  }

  async function handleDelete(id) {
    const tx = await runRequest("DELETE", `/api/tickets/${id}`, "tickets.delete");
    if (tx.ok) {
      setTickets((prev) => prev.filter((t) => t.id !== id));
    } else {
      setError(tx.responseBody?.error ?? "Could not delete ticket.");
    }
  }

  return (
    <div>
      <h2 className="section-title">Tickets</h2>
      {error && <div className="error-banner">{error}</div>}

      <form className="form-row" onSubmit={handleCreate}>
        <div className="field">
          <label htmlFor="t-section">Seat section</label>
          <input
            id="t-section"
            value={form.seat_section}
            onChange={(e) => setForm({ ...form, seat_section: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="t-price">Price</label>
          <input
            id="t-price"
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="t-show">Show</label>
          <select id="t-show" value={form.show_id} onChange={(e) => setForm({ ...form, show_id: e.target.value })}>
            {shows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" type="submit" disabled={shows.length === 0}>
          Add ticket
        </button>
      </form>
      {shows.length === 0 && <p style={{ color: "var(--paper-dim)" }}>Add a show first.</p>}

      <table>
        <thead>
          <tr>
            <th>Section</th>
            <th>Price</th>
            <th>Status</th>
            <th>Show</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tickets.length === 0 && (
            <tr className="empty-row">
              <td colSpan={6}>No tickets issued yet.</td>
            </tr>
          )}
          {tickets.map((ticket) =>
            editingId === ticket.id ? (
              <tr key={ticket.id}>
                <td>
                  <input
                    value={editForm.seat_section}
                    onChange={(e) => setEditForm({ ...editForm, seat_section: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.price}
                    onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                  />
                </td>
                <td>
                  <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                    <option value="available">available</option>
                    <option value="sold">sold</option>
                  </select>
                </td>
                <td>
                  <select
                    value={editForm.show_id}
                    onChange={(e) => setEditForm({ ...editForm, show_id: e.target.value })}
                  >
                    {shows.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </td>
                <td colSpan={2} className="actions-cell">
                  <button className="btn-quiet" onClick={() => saveEdit(ticket.id)}>
                    Save (PUT)
                  </button>
                  <button className="btn-quiet" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={ticket.id}>
                <td>{ticket.seat_section}</td>
                <td>${ticket.price.toFixed(2)}</td>
                <td>
                  <span className={`status-pill ${ticket.status}`}>
                    {ticket.status}
                    {ticket.buyer_name ? ` · ${ticket.buyer_name}` : ""}
                  </span>
                </td>
                <td>{showTitle(ticket.show_id)}</td>
                <td>
                  <button className="btn-quiet" onClick={() => toggleSold(ticket)}>
                    {ticket.status === "available" ? "Mark sold (PATCH)" : "Release (PATCH)"}
                  </button>
                </td>
                <td className="actions-cell">
                  <button className="btn-quiet" onClick={() => startEdit(ticket)}>
                    Edit
                  </button>
                  <button className="btn-danger" onClick={() => handleDelete(ticket.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
