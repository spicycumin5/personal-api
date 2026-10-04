import { Fragment, useState } from "react";

const EMPTY_FORM = { name: "", city: "", capacity: "" };

export default function VenuesSection({ venues, setVenues, runRequest }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [expandedId, setExpandedId] = useState(null);
  const [showsByVenue, setShowsByVenue] = useState({});
  const [error, setError] = useState(null);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    if (!form.name || !form.city || !form.capacity) {
      setError("Name, city, and capacity are all required.");
      return;
    }
    const tx = await runRequest("POST", "/api/venues", "venues.create", {
      name: form.name,
      city: form.city,
      capacity: Number(form.capacity),
    });
    if (tx.ok) {
      setVenues((prev) => [...prev, tx.responseBody]);
      setForm(EMPTY_FORM);
    } else {
      setError(tx.responseBody?.error ?? "Something went wrong.");
    }
  }

  function startEdit(venue) {
    setEditingId(venue.id);
    setEditForm({ name: venue.name, city: venue.city, capacity: String(venue.capacity) });
  }

  async function saveEdit(id) {
    const tx = await runRequest("PUT", `/api/venues/${id}`, "venues.update", {
      name: editForm.name,
      city: editForm.city,
      capacity: Number(editForm.capacity),
    });
    if (tx.ok) {
      setVenues((prev) => prev.map((v) => (v.id === id ? tx.responseBody : v)));
      setEditingId(null);
    } else {
      setError(tx.responseBody?.error ?? "Something went wrong.");
    }
  }

  async function handleDelete(id) {
    const tx = await runRequest("DELETE", `/api/venues/${id}`, "venues.delete");
    if (tx.ok) {
      setVenues((prev) => prev.filter((v) => v.id !== id));
    } else {
      setError(tx.responseBody?.error ?? "Could not delete venue.");
    }
  }

  async function toggleShows(id) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    const tx = await runRequest("GET", `/api/venues/${id}/shows`, "venues.shows");
    if (tx.ok) {
      setShowsByVenue((prev) => ({ ...prev, [id]: tx.responseBody }));
    }
  }

  return (
    <div>
      <h2 className="section-title">Venues</h2>
      {error && <div className="error-banner">{error}</div>}

      <form className="form-row" onSubmit={handleCreate}>
        <div className="field">
          <label htmlFor="v-name">Name</label>
          <input id="v-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="v-city">City</label>
          <input id="v-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="v-capacity">Capacity</label>
          <input
            id="v-capacity"
            type="number"
            min="1"
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          />
        </div>
        <button className="btn btn-primary" type="submit">
          Add venue
        </button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>City</th>
            <th>Capacity</th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {venues.length === 0 && (
            <tr className="empty-row">
              <td colSpan={5}>No venues yet — add one above.</td>
            </tr>
          )}
          {venues.map((venue) =>
            editingId === venue.id ? (
              <tr key={venue.id}>
                <td>
                  <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                </td>
                <td>
                  <input value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} />
                </td>
                <td>
                  <input
                    type="number"
                    value={editForm.capacity}
                    onChange={(e) => setEditForm({ ...editForm, capacity: e.target.value })}
                  />
                </td>
                <td colSpan={2} className="actions-cell">
                  <button className="btn-quiet" onClick={() => saveEdit(venue.id)}>
                    Save
                  </button>
                  <button className="btn-quiet" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </td>
              </tr>
            ) : (
              <Fragment key={venue.id}>
                <tr>
                  <td>{venue.name}</td>
                  <td>{venue.city}</td>
                  <td>{venue.capacity.toLocaleString()}</td>
                  <td>
                    <button className="btn-quiet" onClick={() => toggleShows(venue.id)}>
                      {expandedId === venue.id ? "Hide shows" : "View shows"}
                    </button>
                  </td>
                  <td className="actions-cell">
                    <button className="btn-quiet" onClick={() => startEdit(venue)}>
                      Edit
                    </button>
                    <button className="btn-danger" onClick={() => handleDelete(venue.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
                {expandedId === venue.id && (
                  <tr>
                    <td colSpan={5} style={{ background: "rgba(255,255,255,0.02)" }}>
                      {!showsByVenue[venue.id] ? (
                        "Loading…"
                      ) : showsByVenue[venue.id].length === 0 ? (
                        "No shows booked at this venue yet."
                      ) : (
                        <span>{showsByVenue[venue.id].map((s) => s.title).join(", ")}</span>
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
