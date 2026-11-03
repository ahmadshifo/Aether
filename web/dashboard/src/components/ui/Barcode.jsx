// Member 2: decorative barcode of 1–3 px bars, used on the answer slip and the session ticket.
const BARS = [2, 1, 3, 1, 1, 2, 3, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 3, 1];

export default function Barcode({ count = BARS.length }) {
  return (
    <span className="barcode" aria-hidden="true">
      {BARS.slice(0, count).map((width, i) => <span key={i} style={{ width }} />)}
    </span>
  );
}
