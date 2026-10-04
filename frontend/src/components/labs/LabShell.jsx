import { useState } from "react";

const ARTICLE_BASE = "https://www.hellointerview.com/learn/system-design";

// Frame shared by every lab: title, link to the source article, key takeaways, reset.
export default function LabShell({ title, article, ideas, onReset, children }) {
  const [showIdeas, setShowIdeas] = useState(true);

  return (
    <div className="lab">
      <div className="lab-head">
        <h2 className="section-title">{title}</h2>
        <div className="lab-head-actions">
          {article && (
            <a href={`${ARTICLE_BASE}/${article}`} target="_blank" rel="noreferrer" className="lab-link">
              read the article ↗
            </a>
          )}
          {onReset && (
            <button className="btn" onClick={onReset}>
              Reset lab
            </button>
          )}
        </div>
      </div>

      {ideas && (
        <div className="ideas">
          <button className="ideas-toggle" onClick={() => setShowIdeas((v) => !v)}>
            {showIdeas ? "▾" : "▸"} Key ideas
          </button>
          {showIdeas && (
            <ul>
              {ideas.map((idea) => (
                <li key={idea}>{idea}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {children}
    </div>
  );
}

export function Panel({ title, hint, children, actions }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
        {actions && <div className="panel-actions">{actions}</div>}
      </div>
      {hint && <p className="panel-hint">{hint}</p>}
      {children}
    </section>
  );
}

// Horizontal bar list. items: [{ label, value, tone?, note? }]
export function Bars({ items, max, unit = "" }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="bars">
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <span className="bar-label">{item.label}</span>
          <div className="bar-track">
            <div className={`bar-fill ${item.tone ?? ""}`} style={{ width: `${(100 * item.value) / top}%` }} />
          </div>
          <span className="bar-value">
            {item.value}
            {unit}
            {item.note ? ` ${item.note}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, tone }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Callout({ tone = "info", children }) {
  return <div className={`callout ${tone}`}>{children}</div>;
}
