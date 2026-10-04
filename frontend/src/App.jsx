import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import TransactionStub from "./components/TransactionStub";
import VenuesSection from "./components/VenuesSection";
import ShowsSection from "./components/ShowsSection";
import TicketsSection from "./components/TicketsSection";
import DeliveryLab from "./components/labs/DeliveryLab";
import NetworkingLab from "./components/labs/NetworkingLab";
import ApiDesignLab from "./components/labs/ApiDesignLab";
import DataModelingLab from "./components/labs/DataModelingLab";
import CachingLab from "./components/labs/CachingLab";
import ShardingLab from "./components/labs/ShardingLab";
import HashRingLab from "./components/labs/HashRingLab";
import CapLab from "./components/labs/CapLab";

const GROUPS = [
  {
    id: "desk",
    label: "Ticket Desk",
    tabs: [
      { id: "venues", label: "Venues" },
      { id: "shows", label: "Shows" },
      { id: "tickets", label: "Tickets" },
    ],
  },
  {
    id: "concepts",
    label: "System Design Labs",
    tabs: [
      { id: "delivery", label: "Delivery", Lab: DeliveryLab },
      { id: "networking", label: "Networking", Lab: NetworkingLab },
      { id: "api", label: "API Design", Lab: ApiDesignLab },
      { id: "data", label: "Data Modeling", Lab: DataModelingLab },
      { id: "caching", label: "Caching", Lab: CachingLab },
      { id: "sharding", label: "Sharding", Lab: ShardingLab },
      { id: "ring", label: "Consistent Hashing", Lab: HashRingLab },
      { id: "cap", label: "CAP", Lab: CapLab },
    ],
  },
];

const groupOf = (tabId) => GROUPS.find((g) => g.tabs.some((t) => t.id === tabId));

export default function App() {
  const [activeTab, setActiveTab] = useState("venues");
  const [venues, setVenues] = useState([]);
  const [shows, setShows] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const nextTxId = useRef(1);

  // opts.headers / opts.timeoutMs go to fetch; opts.quiet skips the transaction log (for polling).
  async function runRequest(method, path, snippetKey, body, opts = {}) {
    const tx = await apiRequest(method, path, body, opts);
    const withKey = { ...tx, snippetKey, id: nextTxId.current++ };
    if (!opts.quiet) setTransactions((prev) => [withKey, ...prev].slice(0, 30));
    return withKey;
  }

  useEffect(() => {
    (async () => {
      const [v, s, t] = await Promise.all([
        runRequest("GET", "/api/venues", "venues.list"),
        runRequest("GET", "/api/shows", "shows.list"),
        runRequest("GET", "/api/tickets", "tickets.list"),
      ]);
      if (v.ok) setVenues(v.responseBody);
      if (s.ok) setShows(s.responseBody);
      if (t.ok) setTickets(t.responseBody);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeGroup = groupOf(activeTab);
  const ActiveLab = activeGroup.tabs.find((t) => t.id === activeTab).Lab;

  return (
    <div className="shell">
      <header className="marquee">
        <h1>Ticket Desk</h1>
        <span className="tagline">a REST API you can watch work</span>
        <nav className="group-switch">
          {GROUPS.map((g) => (
            <button
              key={g.id}
              className={activeGroup.id === g.id ? "active" : ""}
              onClick={() => setActiveTab(g.tabs[0].id)}
            >
              {g.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="layout">
        <main className="counter">
          <nav className="tab-row">
            {activeGroup.tabs.map((tab) => (
              <button
                key={tab.id}
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {activeTab === "venues" && (
            <VenuesSection venues={venues} setVenues={setVenues} runRequest={runRequest} />
          )}
          {activeTab === "shows" && (
            <ShowsSection shows={shows} setShows={setShows} venues={venues} runRequest={runRequest} />
          )}
          {activeTab === "tickets" && (
            <TicketsSection tickets={tickets} setTickets={setTickets} shows={shows} runRequest={runRequest} />
          )}
          {ActiveLab && <ActiveLab runRequest={runRequest} shows={shows} goTo={setActiveTab} />}
        </main>

        <TransactionStub transactions={transactions} onClear={() => setTransactions([])} />
      </div>
    </div>
  );
}
