// Member 2: Receipt Printer: "Print answer slip" slides a paper slip out of a dark slot in 900 ms.
import { useId, useState } from 'react';

export default function ReceiptPrinter({ children }) {
  const [open, setOpen] = useState(false);
  const slipId = useId();

  return (
    <>
      <button type="button" className={`btn${open ? '' : ' btn-primary'} self-start`}
        aria-expanded={open} aria-controls={slipId} onClick={() => setOpen(!open)}>
        {open ? 'Tear off slip' : 'Print answer slip'}
      </button>
      <div className="receipt-slot" aria-hidden="true" />
      <div id={slipId} className={`receipt-wrap${open ? ' is-open' : ''}`} aria-hidden={!open}>
        {children}
      </div>
    </>
  );
}
