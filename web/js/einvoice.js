/* PDF Werkbank – E-Rechnung (ab Version 1.9)
 *   WBEInvoice.cii(data, { xrechnung })   CII-XML nach EN 16931 (ZUGFeRD 2 / Factur-X „EN 16931“ bzw. XRechnung 3.0)
 *   WBEInvoice.zugferd(pdfBytes, xml)     PDF/A-3b mit eingebetteter factur-x.xml
 *   WBEInvoice.parse(xmlText)             CII oder UBL (XRechnung) lesen → einheitliches Modell
 *   WBEInvoice.fromPdf(pdfjsDoc)          eingebettete Rechnungsdaten aus einer PDF holen
 *   WBEInvoice.toPdf(model)               lesbare PDF aus den Rechnungsdaten
 *   WBEInvoice.html(model)                Übersicht als HTML
 * data aus dem Rechnungsassistenten: { profile, to, no, date, service, items: [{ desc, qty, unit, price }], terms, buyerEmail, buyerVatId, leitweg, note }
 */
(function (global) {
  'use strict';
  const PL = () => global.PDFLib;
  const x = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const esc = x;
  const num = v => { const s = String(v == null ? '' : v).trim().replace(/\s|€/g, ''); if (!s) return 0; const n = parseFloat(/,/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s); return isFinite(n) ? n : 0; };
  const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const a2 = n => r2(n).toFixed(2);
  const qn = n => String(Math.round(n * 10000) / 10000);
  const eur = (n, cur = 'EUR') => (+n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur === 'EUR' ? ' €' : ' ' + cur);
  /* „20.11.2026“, „2026-11-20“ → Date */
  function pDate(s) {
    s = String(s || '').trim();
    let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s); if (m) return new Date(+(m[3].length === 2 ? '20' + m[3] : m[3]), +m[2] - 1, +m[1]);
    m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    return null;
  }
  const d102 = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const deDate = d => (d ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
  const UNIT = [[/^(std|stunde|h\b|hrs?)/i, 'HUR'], [/^(min)/i, 'MIN'], [/^(tag|tage|d\b|pt)/i, 'DAY'], [/^(woche)/i, 'WEE'], [/^(monat|mon)/i, 'MON'], [/^(jahr)/i, 'ANN'], [/^(stk|stück|st\b)/i, 'H87'], [/^(pausch|psch|pauschal)/i, 'LS'], [/^(km)/i, 'KMT'], [/^(kg)/i, 'KGM'], [/^(m²|qm|m2)/i, 'MTK'], [/^(m\b|meter)/i, 'MTR'], [/^(l\b|liter)/i, 'LTR'], [/^(seite)/i, 'C62']];
  const unitCode = u => { u = String(u || '').trim(); for (const [re, c] of UNIT) if (re.test(u)) return c; return 'C62'; };
  const UNIT_DE = { HUR: 'Std.', MIN: 'Min.', DAY: 'Tag(e)', WEE: 'Woche(n)', MON: 'Monat(e)', ANN: 'Jahr(e)', H87: 'Stk.', LS: 'pauschal', KMT: 'km', KGM: 'kg', MTK: 'm²', MTR: 'm', LTR: 'l', C62: '', XPP: 'Stk.', EA: 'Stk.' };
  /* Anschrift aus freiem Text: Name, Straße, PLZ Ort, Land */
  function addr(text) {
    const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
    const out = { name: lines[0] || '', line1: '', line2: '', zip: '', city: '', country: 'DE' };
    const rest = lines.slice(1);
    let i = rest.findIndex(l => /^(D-|DE-|A-|AT-|CH-)?\d{4,5}\s+\S/.test(l));
    if (i >= 0) {
      const m = /^(?:(D|DE|A|AT|CH)-)?(\d{4,5})\s+(.+)$/.exec(rest[i]);
      out.zip = m[2]; out.city = m[3];
      if (m[1]) out.country = { D: 'DE', DE: 'DE', A: 'AT', AT: 'AT', CH: 'CH' }[m[1]];
      else if (m[2].length === 4) out.country = /schweiz|switzerland/i.test(rest.join(' ')) ? 'CH' : 'AT';
      const after = rest.slice(i + 1).join(' ');
      if (/österreich|austria/i.test(after)) out.country = 'AT'; else if (/schweiz|switzerland/i.test(after)) out.country = 'CH';
      const before = rest.slice(0, i);
      out.line1 = before[before.length - 1] || ''; out.line2 = before.slice(0, -1).join(', ');
    } else { out.line1 = rest[0] || ''; out.city = rest[1] || ''; }
    return out;
  }
  function splitCity(s) { const m = /^(\d{4,5})\s+(.+)$/.exec(String(s || '').trim()); return m ? { zip: m[1], city: m[2] } : { zip: '', city: String(s || '').trim() }; }

  /* ---------- Erzeugen (CII, EN 16931) ---------- */
  function totals(data) {
    const P = data.profile, ku = !!P.kleinunternehmer, rate = ku ? 0 : (num(P.vat) || 19);
    const lines = data.items.map((it, i) => { const q = num(it.qty) || 0, p = num(it.price); return { i: i + 1, name: String(it.desc || '').trim() || `Position ${i + 1}`, q, p, unit: unitCode(it.unit), net: r2(q * p) }; });
    const net = r2(lines.reduce((s, l) => s + l.net, 0)), tax = r2(net * rate / 100);
    return { lines, net, tax, gross: r2(net + tax), rate, ku };
  }
  function cii(data, opt = {}) {
    const P = data.profile, T = totals(data), xr = !!opt.xrechnung;
    const date = pDate(data.date) || new Date(), due = new Date(date); due.setDate(due.getDate() + (num(data.terms) || 0));
    const svc = pDate(data.service);
    const buyer = addr(data.to), seller = splitCity(P.city);
    const cat = T.ku ? 'E' : (T.rate ? 'S' : 'Z');
    const sellerName = P.company || P.name;
    const reason = T.ku ? 'Kleinunternehmer gemäß § 19 UStG – keine Umsatzsteuer' : '';
    const terms = num(data.terms) > 0 ? `Zahlbar innerhalb von ${num(data.terms)} Tagen ohne Abzug bis ${deDate(due)}.` : 'Zahlbar sofort ohne Abzug.';
    const guideline = xr ? 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0' : 'urn:cen.eu:en16931:2017';
    const tel = P.phone ? `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${x(P.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` : '';
    const mail = P.email ? `<ram:EmailURIUniversalCommunication><ram:URIID>${x(P.email)}</ram:URIID></ram:EmailURIUniversalCommunication>` : '';
    const notes = [T.ku ? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.' : '', data.note || ''].filter(Boolean);
    return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${guideline}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${x(data.no)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${d102(date)}</udt:DateTimeString></ram:IssueDateTime>
${notes.map(n => `    <ram:IncludedNote><ram:Content>${x(n)}</ram:Content></ram:IncludedNote>`).join('\n')}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${T.lines.map(l => `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${l.i}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${x(l.name.split('\n')[0].slice(0, 200))}</ram:Name>${l.name.includes('\n') ? `<ram:Description>${x(l.name)}</ram:Description>` : ''}</ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${qn(l.p)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${l.unit}">${qn(l.q)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${cat}</ram:CategoryCode><ram:RateApplicablePercent>${T.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${a2(l.net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join('\n')}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${x(data.leitweg || data.no)}</ram:BuyerReference>
      <ram:SellerTradeParty>
        ${!P.vatId && (P.taxId || P.email) ? `<ram:ID>${x(P.taxId || P.email)}</ram:ID>` : ''}
        <ram:Name>${x(sellerName)}</ram:Name>
        ${P.name || tel || mail ? `<ram:DefinedTradeContact>${P.name ? `<ram:PersonName>${x(P.name)}</ram:PersonName>` : ''}${tel}${mail}</ram:DefinedTradeContact>` : ''}
        <ram:PostalTradeAddress>${seller.zip ? `<ram:PostcodeCode>${x(seller.zip)}</ram:PostcodeCode>` : ''}${P.street ? `<ram:LineOne>${x(P.street)}</ram:LineOne>` : ''}<ram:CityName>${x(seller.city)}</ram:CityName><ram:CountryID>${x(P.country || 'DE')}</ram:CountryID></ram:PostalTradeAddress>
        ${P.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(P.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
        ${P.taxId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${x(P.taxId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}${P.vatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(P.vatId.replace(/\s/g, ''))}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${x(buyer.name)}</ram:Name>
        <ram:PostalTradeAddress>${buyer.zip ? `<ram:PostcodeCode>${x(buyer.zip)}</ram:PostcodeCode>` : ''}${buyer.line1 ? `<ram:LineOne>${x(buyer.line1)}</ram:LineOne>` : ''}${buyer.line2 ? `<ram:LineTwo>${x(buyer.line2)}</ram:LineTwo>` : ''}<ram:CityName>${x(buyer.city)}</ram:CityName><ram:CountryID>${buyer.country}</ram:CountryID></ram:PostalTradeAddress>
        ${data.buyerEmail ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(data.buyerEmail)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
        ${data.buyerVatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(data.buyerVatId.replace(/\s/g, ''))}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${d102(svc || date)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>${x(data.no)}</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      ${P.iban ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${x(P.iban.replace(/\s/g, ''))}</ram:IBANID><ram:AccountName>${x(sellerName)}</ram:AccountName></ram:PayeePartyCreditorFinancialAccount>${P.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${x(P.bic.replace(/\s/g, ''))}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}</ram:SpecifiedTradeSettlementPaymentMeans>` : '<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>1</ram:TypeCode></ram:SpecifiedTradeSettlementPaymentMeans>'}
      <ram:ApplicableTradeTax><ram:CalculatedAmount>${a2(T.tax)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${reason ? `<ram:ExemptionReason>${x(reason)}</ram:ExemptionReason>` : ''}<ram:BasisAmount>${a2(T.net)}</ram:BasisAmount><ram:CategoryCode>${cat}</ram:CategoryCode><ram:RateApplicablePercent>${T.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms><ram:Description>${x(terms)}</ram:Description><ram:DueDateDateTime><udt:DateTimeString format="102">${d102(due)}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${a2(T.net)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${a2(T.net)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${a2(T.tax)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${a2(T.gross)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${a2(T.gross)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`.replace(/\n\s*\n/g, '\n');
  }
  /* Was für XRechnung (Behörden) zusätzlich nötig ist */
  function xrMissing(data) {
    const P = data.profile, m = [];
    if (!data.leitweg) m.push('Leitweg-ID des Empfängers');
    if (!P.name) m.push('dein Name (Ansprechpartner)');
    if (!P.phone) m.push('deine Telefonnummer');
    if (!P.email) m.push('deine E-Mail-Adresse');
    if (!data.buyerEmail) m.push('E-Mail-Adresse des Empfängers');
    if (!P.iban) m.push('deine IBAN');
    return m;
  }
  async function zugferd(pdfBytes, xml, meta = {}) {
    if (!global.WBPdfA) throw new Error('PDF/A-Modul fehlt.');
    return global.WBPdfA.make(pdfBytes, { ...meta, part: 3, lang: 'de-DE', attachments: [{ name: 'factur-x.xml', bytes: new TextEncoder().encode(xml), mime: 'text/xml', desc: 'Rechnungsdaten (ZUGFeRD / Factur-X)', rel: 'Alternative' }], fx: { file: 'factur-x.xml', level: 'EN 16931' } });
  }

  /* ---------- Lesen ---------- */
  function parse(text) {
    const doc = new DOMParser().parseFromString(String(text).replace(/^﻿/, ''), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Die XML-Datei ist fehlerhaft.');
    const root = doc.documentElement, ln = root.localName;
    const kids = (el, name) => (el ? [...el.children].filter(c => c.localName === name) : []);
    const q = (el, path) => { let cur = [el]; for (const p of path.split('/')) { cur = cur.flatMap(c => kids(c, p)); if (!cur.length) return null; } return cur[0]; };
    const qa = (el, path) => { let cur = [el]; for (const p of path.split('/')) cur = cur.flatMap(c => kids(c, p)); return cur; };
    const t = (el, path) => { const n = path ? q(el, path) : el; return n ? n.textContent.trim() : ''; };
    const nm = (el, path) => num(t(el, path).replace(',', '.'));
    if (ln === 'CrossIndustryInvoice') {
      const ex = q(root, 'ExchangedDocument'), tr = q(root, 'SupplyChainTradeTransaction');
      const ag = q(tr, 'ApplicableHeaderTradeAgreement'), st = q(tr, 'ApplicableHeaderTradeSettlement'), dl = q(tr, 'ApplicableHeaderTradeDelivery');
      const party = p => p && {
        name: t(p, 'Name'), line1: t(p, 'PostalTradeAddress/LineOne'), line2: t(p, 'PostalTradeAddress/LineTwo'), zip: t(p, 'PostalTradeAddress/PostcodeCode'), city: t(p, 'PostalTradeAddress/CityName'), country: t(p, 'PostalTradeAddress/CountryID'),
        taxId: (qa(p, 'SpecifiedTaxRegistration/ID').find(i => i.getAttribute('schemeID') === 'FC') || { textContent: '' }).textContent.trim(),
        vatId: (qa(p, 'SpecifiedTaxRegistration/ID').find(i => i.getAttribute('schemeID') === 'VA') || { textContent: '' }).textContent.trim(),
        contact: t(p, 'DefinedTradeContact/PersonName'), phone: t(p, 'DefinedTradeContact/TelephoneUniversalCommunication/CompleteNumber'), email: t(p, 'DefinedTradeContact/EmailURIUniversalCommunication/URIID') || t(p, 'URIUniversalCommunication/URIID'),
      };
      const sum = q(st, 'SpecifiedTradeSettlementHeaderMonetarySummation');
      const pm = q(st, 'SpecifiedTradeSettlementPaymentMeans');
      const d = s => { const v = t(s); return v ? pDate(v) : null; };
      return {
        format: /xrechnung/i.test(t(root, 'ExchangedDocumentContext/GuidelineSpecifiedDocumentContextParameter/ID')) ? 'XRechnung (CII)' : 'ZUGFeRD / Factur-X (CII)',
        type: t(ex, 'TypeCode'), no: t(ex, 'ID'), date: d(q(ex, 'IssueDateTime/DateTimeString')), notes: qa(ex, 'IncludedNote/Content').map(n => n.textContent.trim()).filter(Boolean),
        buyerRef: t(ag, 'BuyerReference'), seller: party(q(ag, 'SellerTradeParty')), buyer: party(q(ag, 'BuyerTradeParty')),
        delivery: d(q(dl, 'ActualDeliverySupplyChainEvent/OccurrenceDateTime/DateTimeString')), currency: t(st, 'InvoiceCurrencyCode') || 'EUR', payRef: t(st, 'PaymentReference'),
        lines: qa(tr, 'IncludedSupplyChainTradeLineItem').map(li => ({ id: t(li, 'AssociatedDocumentLineDocument/LineID'), name: t(li, 'SpecifiedTradeProduct/Name'), desc: t(li, 'SpecifiedTradeProduct/Description'), qty: nm(li, 'SpecifiedLineTradeDelivery/BilledQuantity'), unit: (q(li, 'SpecifiedLineTradeDelivery/BilledQuantity') || { getAttribute: () => '' }).getAttribute('unitCode'), price: nm(li, 'SpecifiedLineTradeAgreement/NetPriceProductTradePrice/ChargeAmount'), net: nm(li, 'SpecifiedLineTradeSettlement/SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount'), rate: nm(li, 'SpecifiedLineTradeSettlement/ApplicableTradeTax/RateApplicablePercent') })),
        taxes: qa(st, 'ApplicableTradeTax').map(tx => ({ cat: t(tx, 'CategoryCode'), rate: nm(tx, 'RateApplicablePercent'), basis: nm(tx, 'BasisAmount'), amount: nm(tx, 'CalculatedAmount'), reason: t(tx, 'ExemptionReason') })),
        net: nm(sum, 'TaxBasisTotalAmount') || nm(sum, 'LineTotalAmount'), tax: nm(sum, 'TaxTotalAmount'), gross: nm(sum, 'GrandTotalAmount'), payable: nm(sum, 'DuePayableAmount'),
        iban: t(pm, 'PayeePartyCreditorFinancialAccount/IBANID'), accountName: t(pm, 'PayeePartyCreditorFinancialAccount/AccountName'), bic: t(pm, 'PayeeSpecifiedCreditorFinancialInstitution/BICID'),
        terms: t(st, 'SpecifiedTradePaymentTerms/Description'), due: d(q(st, 'SpecifiedTradePaymentTerms/DueDateDateTime/DateTimeString')),
      };
    }
    if (ln === 'Invoice' || ln === 'CreditNote') {
      const party = p => p && {
        name: t(p, 'Party/PartyLegalEntity/RegistrationName') || t(p, 'Party/PartyName/Name'), line1: t(p, 'Party/PostalAddress/StreetName'), line2: t(p, 'Party/PostalAddress/AdditionalStreetName'), zip: t(p, 'Party/PostalAddress/PostalZone'), city: t(p, 'Party/PostalAddress/CityName'), country: t(p, 'Party/PostalAddress/Country/IdentificationCode'),
        vatId: (qa(p, 'Party/PartyTaxScheme').find(s => t(s, 'TaxScheme/ID') === 'VAT') ? t(qa(p, 'Party/PartyTaxScheme').find(s => t(s, 'TaxScheme/ID') === 'VAT'), 'CompanyID') : ''),
        taxId: (qa(p, 'Party/PartyTaxScheme').find(s => t(s, 'TaxScheme/ID') !== 'VAT') ? t(qa(p, 'Party/PartyTaxScheme').find(s => t(s, 'TaxScheme/ID') !== 'VAT'), 'CompanyID') : ''),
        contact: t(p, 'Party/Contact/Name'), phone: t(p, 'Party/Contact/Telephone'), email: t(p, 'Party/Contact/ElectronicMail') || t(p, 'Party/EndpointID'),
      };
      const tot = q(root, 'LegalMonetaryTotal'), pm = q(root, 'PaymentMeans');
      const lineTag = ln === 'Invoice' ? 'InvoiceLine' : 'CreditNoteLine', qtyTag = ln === 'Invoice' ? 'InvoicedQuantity' : 'CreditedQuantity';
      return {
        format: /xrechnung/i.test(t(root, 'CustomizationID')) ? 'XRechnung (UBL)' : 'UBL', type: t(root, ln === 'Invoice' ? 'InvoiceTypeCode' : 'CreditNoteTypeCode') || (ln === 'CreditNote' ? '381' : '380'),
        no: t(root, 'ID'), date: pDate(t(root, 'IssueDate')), notes: qa(root, 'Note').map(n => n.textContent.trim()).filter(Boolean), buyerRef: t(root, 'BuyerReference'),
        seller: party(q(root, 'AccountingSupplierParty')), buyer: party(q(root, 'AccountingCustomerParty')), delivery: pDate(t(root, 'Delivery/ActualDeliveryDate')), currency: t(root, 'DocumentCurrencyCode') || 'EUR', payRef: t(pm, 'PaymentID'),
        lines: qa(root, lineTag).map(li => ({ id: t(li, 'ID'), name: t(li, 'Item/Name'), desc: t(li, 'Item/Description'), qty: nm(li, qtyTag), unit: (q(li, qtyTag) || { getAttribute: () => '' }).getAttribute('unitCode'), price: nm(li, 'Price/PriceAmount'), net: nm(li, 'LineExtensionAmount'), rate: nm(li, 'Item/ClassifiedTaxCategory/Percent') })),
        taxes: qa(root, 'TaxTotal/TaxSubtotal').map(s => ({ cat: t(s, 'TaxCategory/ID'), rate: nm(s, 'TaxCategory/Percent'), basis: nm(s, 'TaxableAmount'), amount: nm(s, 'TaxAmount'), reason: t(s, 'TaxCategory/TaxExemptionReason') })),
        net: nm(tot, 'TaxExclusiveAmount'), tax: nm(q(root, 'TaxTotal'), 'TaxAmount'), gross: nm(tot, 'TaxInclusiveAmount'), payable: nm(tot, 'PayableAmount'),
        iban: t(pm, 'PayeeFinancialAccount/ID'), accountName: t(pm, 'PayeeFinancialAccount/Name'), bic: t(pm, 'PayeeFinancialAccount/FinancialInstitutionBranch/ID'),
        terms: t(root, 'PaymentTerms/Note'), due: pDate(t(root, 'DueDate') || t(pm, 'PaymentDueDate')),
      };
    }
    throw new Error('Das ist keine bekannte E-Rechnung (erwartet: ZUGFeRD/Factur-X, XRechnung CII oder UBL).');
  }
  const TYPE = { 380: 'Rechnung', 381: 'Gutschrift', 384: 'Korrekturrechnung', 389: 'Gutschrift (Selbstfakturierung)', 326: 'Teilrechnung', 875: 'Abschlagsrechnung', 877: 'Schlussrechnung' };
  const looksXml = s => /<(\w+:)?(CrossIndustryInvoice|Invoice|CreditNote)[\s>]/.test(s);
  /* pdf.js-Dokument → { name, xml } oder null */
  async function fromPdf(pdf) {
    let att = null; try { att = await pdf.getAttachments(); } catch (e) { return null; }
    if (!att) return null;
    const files = Object.values(att);
    const pref = ['factur-x.xml', 'zugferd-invoice.xml', 'xrechnung.xml', 'zugferd.xml'];
    files.sort((a, b) => (pref.indexOf(String(b.filename).toLowerCase()) >= 0) - (pref.indexOf(String(a.filename).toLowerCase()) >= 0));
    for (const f of files) {
      if (!/\.xml$/i.test(f.filename || '')) continue;
      const s = new TextDecoder().decode(f.content);
      if (looksXml(s)) return { name: f.filename, xml: s };
    }
    return null;
  }
  const partyLines = p => (p ? [p.name, p.contact && p.contact !== p.name ? p.contact : '', p.line1, p.line2, [p.zip, p.city].filter(Boolean).join(' '), p.country && p.country !== 'DE' ? p.country : ''].filter(Boolean) : []);
  function html(m) {
    const cur = m.currency;
    const pt = p => `${partyLines(p).map(esc).join('<br>')}${p && p.vatId ? `<br><small>USt-IdNr. ${esc(p.vatId)}</small>` : ''}${p && p.taxId ? `<br><small>Steuernr. ${esc(p.taxId)}</small>` : ''}${p && p.email ? `<br><small>${esc(p.email)}</small>` : ''}`;
    return `<div class="einv">
      <div class="einv-h"><b>${esc(TYPE[m.type] || 'Rechnung')} ${esc(m.no)}</b><span class="pill">${esc(m.format)}</span></div>
      <div class="einv-g"><div><small>Von</small><p>${pt(m.seller)}</p></div><div><small>An</small><p>${pt(m.buyer)}</p></div>
      <div><small>Daten</small><p>Datum: ${esc(deDate(m.date))}${m.delivery ? `<br>Leistung: ${esc(deDate(m.delivery))}` : ''}${m.due ? `<br>Fällig: <b>${esc(deDate(m.due))}</b>` : ''}${m.buyerRef && m.buyerRef !== m.no ? `<br>Referenz: ${esc(m.buyerRef)}` : ''}</p></div></div>
      <table class="einv-t"><thead><tr><th>Pos.</th><th>Leistung</th><th>Menge</th><th>Einzelpreis</th><th>USt.</th><th>Netto</th></tr></thead><tbody>${m.lines.map(l => `<tr><td>${esc(l.id)}</td><td>${esc(l.name)}${l.desc && l.desc !== l.name ? `<br><small>${esc(l.desc)}</small>` : ''}</td><td>${(+l.qty).toLocaleString('de-DE')} ${esc(UNIT_DE[l.unit] != null ? UNIT_DE[l.unit] : l.unit)}</td><td>${eur(l.price, cur)}</td><td>${(+l.rate).toLocaleString('de-DE')} %</td><td>${eur(l.net, cur)}</td></tr>`).join('')}</tbody></table>
      <div class="einv-s"><span>Netto</span><b>${eur(m.net, cur)}</b>${m.taxes.map(tx => `<span>USt. ${(+tx.rate).toLocaleString('de-DE')} %${tx.reason ? ` <small>(${esc(tx.reason)})</small>` : ''}</span><b>${eur(tx.amount, cur)}</b>`).join('')}<span>Gesamt</span><b>${eur(m.gross, cur)}</b>${m.payable !== m.gross ? `<span>Zu zahlen</span><b>${eur(m.payable, cur)}</b>` : ''}</div>
      ${m.iban || m.terms ? `<p class="note">${m.iban ? `Bankverbindung: <b>${esc(m.iban.replace(/(.{4})/g, '$1 ').trim())}</b>${m.bic ? ` · BIC ${esc(m.bic)}` : ''}${m.accountName ? ` · ${esc(m.accountName)}` : ''}<br>` : ''}${m.payRef ? `Verwendungszweck: ${esc(m.payRef)}<br>` : ''}${esc(m.terms || '')}</p>` : ''}
      ${m.notes.length ? `<p class="note">${m.notes.map(esc).join('<br>')}</p>` : ''}</div>`;
  }
  /* GiroCode (EPC-QR) für Banking-Apps */
  function epc(m) {
    if (!m.iban || !(m.payable || m.gross) || (m.currency && m.currency !== 'EUR')) return '';
    return ['BCD', '002', '1', 'SCT', m.bic || '', (m.accountName || (m.seller && m.seller.name) || '').slice(0, 70), m.iban.replace(/\s/g, ''), 'EUR' + (m.payable || m.gross).toFixed(2), '', '', (m.payRef || m.no || '').slice(0, 140)].join('\n');
  }
  /* lesbare PDF */
  async function toPdf(m) {
    const { PDFDocument, StandardFonts, rgb } = PL();
    const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), b = await d.embedFont(StandardFonts.HelveticaBold);
    const W = 595.28, H = 841.89, L = 62, R = W - 56, ink = rgb(0.11, 0.13, 0.19), mute = rgb(0.42, 0.45, 0.52), line = rgb(0.8, 0.82, 0.86);
    const safe = s => Array.from(String(s == null ? '' : s)).map(ch => { if (ch === '\n') return ch; try { f.encodeText(ch); return ch; } catch (e) { return '?'; } }).join('');
    const T = (pg, s, x0, y, size, font = f, color = ink, align) => { const t = safe(s), w = font.widthOfTextAtSize(t, size); pg.drawText(t, { x: align === 'r' ? x0 - w : x0, y, size, font, color }); };
    const wrap = (s, size, width) => { const out = []; for (const para of safe(s).split('\n')) { let ln = ''; for (const w of para.split(/\s+/)) { const tt = ln ? ln + ' ' + w : w; if (f.widthOfTextAtSize(tt, size) <= width || !ln) ln = tt; else { out.push(ln); ln = w; } } out.push(ln); } return out; };
    let pg = d.addPage([W, H]), y = H - 60;
    T(pg, 'Ansicht einer E-Rechnung · erstellt von PDF Werkbank aus den Rechnungsdaten', L, H - 30, 7, f, mute);
    T(pg, (m.seller && m.seller.name) || '', R, y, 13, b, ink, 'r');
    partyLines(m.seller).slice(1).forEach((t, i) => T(pg, t, R, y - 15 - i * 11, 9, f, mute, 'r'));
    y = H - 150;
    partyLines(m.buyer).forEach((t, i) => T(pg, t, L, y - i * 14, 11, i ? f : b));
    const info = [['Nummer', m.no], ['Datum', deDate(m.date)], ...(m.delivery ? [['Leistungsdatum', deDate(m.delivery)]] : []), ...(m.due ? [['Fällig am', deDate(m.due)]] : []), ...(m.buyerRef && m.buyerRef !== m.no ? [['Referenz', m.buyerRef]] : [])];
    info.forEach(([k, v], i) => { T(pg, k, R - 170, y - i * 14, 9, f, mute); T(pg, v, R, y - i * 14, 9, b, ink, 'r'); });
    y -= Math.max(5, info.length) * 14 + 30;
    T(pg, `${TYPE[m.type] || 'Rechnung'} ${m.no}`, L, y, 16, b); y -= 28;
    const cx = [L, L + 26, R - 195, R - 125, R - 80, R];
    const head = () => { pg.drawRectangle({ x: L - 4, y: y - 5, width: R - L + 8, height: 18, color: rgb(0.95, 0.96, 0.98) }); ['Pos.', 'Leistung'].forEach((h, i) => T(pg, h, cx[i], y, 8.5, b, mute)); ['Menge', 'Einzelpreis', 'USt.', 'Netto'].forEach((h, i) => T(pg, h, cx[i + 2], y, 8.5, b, mute, 'r')); y -= 20; };
    head();
    for (const l of m.lines) {
      const txt = wrap(l.name + (l.desc && l.desc !== l.name ? '\n' + l.desc : ''), 9.5, cx[2] - cx[1] - 70);
      const h = txt.length * 12 + 6;
      if (y - h < 120) { pg = d.addPage([W, H]); y = H - 60; head(); }
      T(pg, l.id, cx[0], y, 9.5); txt.forEach((t, k) => T(pg, t, cx[1], y - k * 12, 9.5));
      T(pg, `${(+l.qty).toLocaleString('de-DE')} ${UNIT_DE[l.unit] != null ? UNIT_DE[l.unit] : l.unit || ''}`.trim(), cx[2], y, 9.5, f, ink, 'r');
      T(pg, eur(l.price, m.currency), cx[3], y, 9.5, f, ink, 'r'); T(pg, `${(+l.rate).toLocaleString('de-DE')} %`, cx[4], y, 9.5, f, ink, 'r'); T(pg, eur(l.net, m.currency), cx[5], y, 9.5, f, ink, 'r');
      y -= h; pg.drawLine({ start: { x: L, y: y + 8 }, end: { x: R, y: y + 8 }, thickness: 0.4, color: line });
    }
    if (y < 200) { pg = d.addPage([W, H]); y = H - 60; }
    y -= 8;
    const rows = [['Nettobetrag', eur(m.net, m.currency)], ...m.taxes.map(tx => [`USt. ${(+tx.rate).toLocaleString('de-DE')} %`, eur(tx.amount, m.currency)]), ['Gesamtbetrag', eur(m.gross, m.currency), 1], ...(m.payable !== m.gross ? [['Zu zahlen', eur(m.payable, m.currency), 1]] : [])];
    for (const [k, v, s] of rows) { T(pg, k, R - 200, y, s ? 11 : 10, s ? b : f); T(pg, v, R, y, s ? 11 : 10, s ? b : f, ink, 'r'); y -= s ? 20 : 15; }
    y -= 10;
    const notes = [...m.taxes.filter(tx => tx.reason && !m.notes.some(n => /§\s*19/.test(n) && /§\s*19/.test(tx.reason))).map(tx => tx.reason), m.terms, m.iban ? `Bankverbindung: IBAN ${m.iban}${m.bic ? ', BIC ' + m.bic : ''}${m.accountName ? ', ' + m.accountName : ''}` : '', m.payRef ? `Verwendungszweck: ${m.payRef}` : '', ...m.notes].filter(Boolean);
    for (const n of notes) for (const ln of wrap(n, 9.5, R - L)) { if (y < 70) { pg = d.addPage([W, H]); y = H - 60; } T(pg, ln, L, y, 9.5); y -= 13; }
    const s = m.seller || {};
    T(pg, [s.taxId && 'Steuernr. ' + s.taxId, s.vatId && 'USt-IdNr. ' + s.vatId, s.phone && 'Tel. ' + s.phone, s.email].filter(Boolean).join(' · '), L, 40, 7.5, f, mute);
    d.setTitle(`${TYPE[m.type] || 'Rechnung'} ${m.no}`); d.setAuthor((m.seller && m.seller.name) || ''); d.setCreator('PDF Werkbank');
    return d.save();
  }
  global.WBEInvoice = { cii, totals, xrMissing, zugferd, parse, fromPdf, toPdf, html, epc, looksXml, addr, unitCode, TYPE };
})(window);
