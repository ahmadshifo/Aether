// Member 2: Ticket: perforated session card with two half-circle notches and a LIVE stub.
import Barcode from './Barcode.jsx';

export default function Ticket({ id, facts, stub = 'LIVE' }) {
  return (
    <section className="ticket" aria-label="Session ticket">
      <div className="ticket-main">
        <span className="label">Session ticket</span>
        <span className="ticket-id">{id}</span>
        <dl className="ticket-facts">
          {facts.map(([term, value]) => (
            <div key={term}><dt className="label">{term}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </div>
      <div className="ticket-perf" aria-hidden="true"><span /><span /></div>
      <div className="ticket-stub">
        <span className="ticket-stub-title">{stub}</span>
        <Barcode count={20} />
      </div>
    </section>
  );
}
