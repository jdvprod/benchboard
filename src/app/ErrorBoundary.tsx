/** Keeps one broken screen from blanking the whole app. Data is never touched; the coach can go back or reload. */
import { Component, ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) {
    try { console.error("Benchboard screen error:", err); } catch { /* ignore */ }
    // a page's code couldn't load (usually a new version was published): reload once to pick it up
    if (isLoadError(err) && navigator.onLine) try { if (!sessionStorage.getItem("bs-reloaded")) { sessionStorage.setItem("bs-reloaded", "1"); location.reload(); } } catch { /* ignore */ }
  }
  componentDidUpdate(prev: { resetKey?: string }) { if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null }); }
  render() {
    if (!this.state.err) return this.props.children;
    if (isLoadError(this.state.err)) return <div className="page"><section className="card" style={{ maxWidth: 560 }}>
      <h2>{navigator.onLine ? "Benchboard was updated" : "This screen isn't on this device yet"}</h2>
      <p className="muted" style={{ margin: "6px 0 12px" }}>{navigator.onLine ? "Reload to get the new version. Your stats are saved." : "Connect to the internet once and it will work offline from then on. Tracking works offline now."}</p>
      <div className="row"><button className="btn primary" onClick={() => location.reload()}>Reload</button><button className="btn" onClick={() => { location.hash = "#/track"; this.setState({ err: null }); }}>Go to Track</button></div>
    </section></div>;
    return <div className="page"><section className="card" style={{ maxWidth: 560 }}>
      <h2>This screen hit a problem</h2>
      <p className="muted" style={{ margin: "6px 0 12px" }}>Your stats are saved. Go back to Track, or reload the app. If it keeps happening, tell us what you tapped.</p>
      <p className="small muted" style={{ fontFamily: "ui-monospace,monospace", marginBottom: 12 }}>{String(this.state.err.message || this.state.err).slice(0, 160)}</p>
      <div className="row"><button className="btn primary" onClick={() => { location.hash = "#/track"; this.setState({ err: null }); }}>Go to Track</button><button className="btn" onClick={() => location.reload()}>Reload</button></div>
    </section></div>;
  }
}

const isLoadError = (e: Error) => /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i.test(String(e?.message || e));
