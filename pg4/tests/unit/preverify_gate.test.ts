import { describe, it, expect } from 'vitest';
import { PreVerifyGate } from '../../src/discovery/website/preverify_gate';
import { normalizeLead } from '../../src/discovery/input_normalizer';

describe('PreVerifyGate', () => {
  it('VERIFIED when P.IVA digits appear in body', () => {
    const lead = normalizeLead({ company_name: 'Acme', city: 'Milano', vat_code: '12345678901' });
    const html =
      '<html><head><title>Acme</title></head><body>Acme è una società italiana. P.IVA 12345678901, sede legale via Roma 1, Milano. Tutti i diritti riservati.</body></html>';
    const r = PreVerifyGate.check('https://acme.it', html, lead);
    expect(r.status).toBe('VERIFIED');
    expect(r.evidence).toBe('piva_match');
  });

  it('VERIFIED_SEMANTIC when stripped brand stem matches the domain (Layer B)', () => {
    const lead = normalizeLead({
      company_name: 'Gecoimmobili SRL',
      city: 'Belluno',
      category: 'agenzie immobiliari',
    });
    // > 800 useful bytes so the tiny_or_parked guard doesn't fire.
    const html =
      '<html><head><title>Gecoimmobili — agenzia immobiliare Belluno</title></head><body>' +
      '<h1>Gecoimmobili</h1>' +
      '<p>Agenzia immobiliare a Belluno, specializzata in compravendita e locazione di appartamenti e ville. ' +
      'Trovi case in vendita, monolocale, bilocale, trilocale, immobili commerciali e residenziali. ' +
      'Da oltre 20 anni a fianco di chi cerca casa nelle Dolomiti. ' +
      'Servizio di valutazione gratuita, consulenza per mutuo e successioni.</p>' +
      '<p>Visita la nostra sede in centro a Belluno per scoprire tutte le proposte. ' +
      'Pubblichiamo costantemente nuove proposte di immobili in vendita e in affitto. ' +
      'Selezioniamo accuratamente solo immobili in linea con le richieste della nostra clientela.</p>' +
      '<p>Servizi offerti: valutazione gratuita, gestione contratti di locazione, consulenza fiscale ' +
      'sugli investimenti immobiliari, consulenza per la stipula di contratti preliminari, ' +
      'verifica della regolarità urbanistica e catastale, supporto per la successione e ' +
      'la divisione ereditaria, ricerche personalizzate.</p>' +
      '<p>Contatti: telefono e email per richiedere informazioni o fissare un appuntamento.</p>' +
      '<p>Gecoimmobili è iscritta al ruolo agenti immobiliari della Camera di Commercio di Belluno.</p>' +
      '</body></html>';
    const r = PreVerifyGate.check('https://gecoimmobili.it', html, lead);
    expect(r.status).toBe('VERIFIED_SEMANTIC');
    expect(r.evidence).toBe('strong_brand');
  });

  it('REJECTED when no signals match', () => {
    const lead = normalizeLead({ company_name: 'Acme SRL', city: 'Milano', vat_code: '12345678901' });
    const html = '<html><body>Welcome to a totally unrelated site</body></html>';
    const r = PreVerifyGate.check('https://random.com', html, lead);
    expect(r.status).toBe('REJECTED');
  });

  it('REJECTED for empty html', () => {
    const lead = normalizeLead({ company_name: 'A', city: 'B' });
    expect(PreVerifyGate.check('https://x.it', '', lead).status).toBe('REJECTED');
  });
});

/**
 * Phase D — pin every false-positive from the Phase C audit so a future
 * loosening of the gate can never resurrect them. Companion to the
 * acceptance set below.
 */
const realEstateBody =
  'Compravendita e locazione di appartamenti. Immobili in vendita. ' +
  'Trovi monolocale, bilocale, trilocale, ville e immobili commerciali. ' +
  'Servizio di valutazione gratuita. Consulenza per mutuo. Selezioniamo ' +
  'accuratamente gli immobili in linea con le richieste della clientela. ' +
  'Pubblichiamo costantemente nuove proposte di immobili in vendita e in affitto. ' +
  'Servizi offerti: gestione contratti di locazione, consulenza fiscale sugli ' +
  'investimenti, verifica della regolarità urbanistica e catastale, supporto per ' +
  'la successione e la divisione ereditaria, ricerche personalizzate per la clientela. ' +
  'Iscritta al ruolo agenti immobiliari della Camera di Commercio. ' +
  'Contatti per richiedere informazioni o fissare un appuntamento con i nostri agenti. ' +
  'La nostra agenzia opera da oltre venti anni nel territorio, garantendo professionalità ' +
  'e serietà a chi cerca casa o desidera vendere il proprio immobile.';

function htmlPage(title: string, body: string): string {
  return `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`;
}

describe('PreVerifyGate — Phase D audit REJECT cases (must NOT match)', () => {
  it('Bloom → bloom.it (single-token denylist)', () => {
    const lead = normalizeLead({ company_name: 'Bloom', city: 'Pieve di Cadore', category: 'agenzie immobiliari' });
    const html = htmlPage('Bloom Org Consulting', realEstateBody);
    const r = PreVerifyGate.check('https://bloom.it', html, lead);
    expect(r.status).toBe('REJECTED');
    expect(r.detail).toMatch(/common_stem/);
  });

  it('Ufficio → ufficio.com (single-token denylist + sector conflict)', () => {
    const lead = normalizeLead({ company_name: 'Ufficio', city: 'Cortina', category: 'agenzie immobiliari' });
    const conflictBody =
      'Cartoleria e cancelleria, toner e cartucce per stampanti. ' +
      'Forniture per ufficio, articoli di cancelleria di alta qualità. '.repeat(8);
    const r = PreVerifyGate.check('https://ufficio.com', htmlPage('Ufficio', conflictBody), lead);
    expect(r.status).toBe('REJECTED');
  });

  it('Area Immobiliare Belluno → areaimmobiliare.com (Bergamo, common stem)', () => {
    const lead = normalizeLead({
      company_name: 'Area Immobiliare',
      city: 'Belluno',
      category: 'agenzie immobiliari',
    });
    // Body mentions Bergamo not Belluno → no city evidence; stripped="area" common stem.
    const html = htmlPage('Area Immobiliare', realEstateBody.replace(/Belluno/g, 'Bergamo') +
      ' La nostra agenzia opera a Bergamo e provincia.');
    const r = PreVerifyGate.check('https://areaimmobiliare.com', html, lead);
    expect(r.status).toBe('REJECTED');
  });

  it('Agenzia Le Torri → agenzialetorri.com (Modena, common stem "torri")', () => {
    const lead = normalizeLead({
      company_name: 'Agenzia Le Torri',
      city: 'Belluno',
      category: 'agenzie immobiliari',
    });
    const html = htmlPage('Le Torri', realEstateBody.replace(/Belluno/g, 'Modena') + ' Modena.');
    const r = PreVerifyGate.check('https://agenzialetorri.com', html, lead);
    expect(r.status).toBe('REJECTED');
  });

  it('La Mia Casa Follina → agenzialamiacasa.it (Cuneo, common stem "mia")', () => {
    const lead = normalizeLead({
      company_name: 'La Mia Casa',
      city: 'Follina',
      category: 'agenzie immobiliari',
    });
    const html = htmlPage('La Mia Casa', realEstateBody.replace(/Belluno/g, 'Cuneo') + ' Cuneo.');
    const r = PreVerifyGate.check('https://agenzialamiacasa.it', html, lead);
    expect(r.status).toBe('REJECTED');
  });

  it('Immobiliare Appia → immobiliareappia.it (Roma, common stem "appia")', () => {
    const lead = normalizeLead({
      company_name: 'Immobiliare Appia',
      city: 'Cortina',
      category: 'agenzie immobiliari',
    });
    const html = htmlPage('Immobiliare Appia', realEstateBody.replace(/Belluno/g, 'Roma') + ' Roma.');
    const r = PreVerifyGate.check('https://immobiliareappia.it', html, lead);
    expect(r.status).toBe('REJECTED');
  });

  it('Dalla Riva (immobiliare) → dallariva.it (carpenteria — sector conflict)', () => {
    const lead = normalizeLead({
      company_name: 'Dalla Riva',
      city: 'Feltre',
      category: 'agenzie immobiliari',
    });
    const conflictBody =
      'Carpenteria metallica, fresatura e tornitura di precisione. ' +
      'Lavorazioni meccaniche di precisione per il settore industriale. '.repeat(8);
    const r = PreVerifyGate.check('https://dallariva.it', htmlPage('Dalla Riva', conflictBody), lead);
    expect(r.status).toBe('REJECTED');
  });

  it('Savim → savim.it (verniciatura industriale — sector conflict)', () => {
    const lead = normalizeLead({
      company_name: 'Savim',
      city: 'Belluno',
      category: 'agenzie immobiliari',
    });
    const conflictBody =
      'Verniciatura industriale e trattamento superfici metalliche. ' +
      'Servizi di carpenteria e meccanica di precisione per industria. '.repeat(8);
    const r = PreVerifyGate.check('https://savim.it', htmlPage('Savim', conflictBody), lead);
    expect(r.status).toBe('REJECTED');
  });

  it('agenziaimmobiliare.it generic portal — no distinctive tokens', () => {
    const lead = normalizeLead({
      company_name: 'Agenzia Immobiliare',
      city: 'Belluno',
      category: 'agenzie immobiliari',
    });
    const html = htmlPage('Agenzia Immobiliare', realEstateBody);
    const r = PreVerifyGate.check('https://agenziaimmobiliare.it', html, lead);
    expect(r.status).toBe('REJECTED');
  });

  it('Agenzia Mercato Immobiliare → am.com (domain stem too short)', () => {
    // 2-3 char domains substring-match into long company-name compacts
    // and used to leak through Layer A. Phase D enforces a 6-char
    // minimum domain stem to block this class of FPs.
    const lead = normalizeLead({
      company_name: 'Agenzia Mercato Immobiliare',
      city: 'Borgo Valbelluna',
      category: 'agenzie immobiliari',
    });
    const html = htmlPage('AM', realEstateBody);
    const r = PreVerifyGate.check('https://am.com', html, lead);
    expect(r.status).toBe('REJECTED');
  });

  it('Studio Belluno → belluno.eu (only token IS the lead city — generic portal)', () => {
    const lead = normalizeLead({
      company_name: 'Studio Belluno SRL',
      city: 'Belluno',
      category: 'agenzie immobiliari',
    });
    const html = htmlPage('Belluno', realEstateBody);
    const r = PreVerifyGate.check('https://belluno.eu', html, lead);
    expect(r.status).toBe('REJECTED');
    expect(r.detail).toMatch(/common_stem/);
  });

  it('Iniziative S.p.a. → iniziative.org (For Sale parking page)', () => {
    const lead = normalizeLead({
      company_name: 'Iniziative S.p.A.',
      city: 'Belluno',
      category: 'agenzie immobiliari',
    });
    const parked =
      '<html><head><title>iniziative.org - For Sale</title></head><body>' +
      'This domain is for sale. Buy this domain via sedo.com. ' +
      'x'.repeat(900) + '</body></html>';
    const r = PreVerifyGate.check('https://iniziative.org', parked, lead);
    expect(r.status).toBe('REJECTED');
    expect(r.detail).toMatch(/tiny_or_parked/);
  });
});

describe('PreVerifyGate — Phase D audit ACCEPT cases (must remain matched)', () => {
  it('Pierobon → agenziaimmobiliareestimopierobon.com (Layer A full-name)', () => {
    const lead = normalizeLead({
      company_name: 'Agenzia Immobiliare Estimo Pierobon',
      city: 'Belluno',
      category: 'agenzie immobiliari',
    });
    const html = htmlPage('Pierobon', `${realEstateBody} Pierobon è la nostra agenzia a Belluno.`);
    const r = PreVerifyGate.check('https://agenziaimmobiliareestimopierobon.com', html, lead);
    expect(r.status).toBe('VERIFIED_SEMANTIC');
    expect(r.evidence).toBe('strong_full_name');
  });

  it('Gecoimmobili → gecoimmobili.it (Layer B brand stem)', () => {
    const lead = normalizeLead({
      company_name: 'Gecoimmobili SRL',
      city: 'Belluno',
      category: 'agenzie immobiliari',
    });
    const html = htmlPage('Gecoimmobili', `${realEstateBody} Sede a Belluno.`);
    const r = PreVerifyGate.check('https://gecoimmobili.it', html, lead);
    expect(r.status).toBe('VERIFIED_SEMANTIC');
    expect(r.evidence).toBe('strong_brand');
  });

  it('Giacin → giacin.com (Layer B)', () => {
    const lead = normalizeLead({
      company_name: 'Giacin',
      city: 'Belluno',
      category: 'agenzie immobiliari',
    });
    const html = htmlPage('Giacin', `${realEstateBody} Studio Giacin a Belluno.`);
    const r = PreVerifyGate.check('https://giacin.com', html, lead);
    expect(r.status).toBe('VERIFIED_SEMANTIC');
  });

  it('Cortina Properties → cortinaproperties.com (Layer A or B)', () => {
    const lead = normalizeLead({
      company_name: 'Cortina Properties',
      city: 'Cortina',
      category: 'agenzie immobiliari',
    });
    const html = htmlPage(
      'Cortina Properties',
      `${realEstateBody.replace(/Belluno/g, 'Cortina')} Cortina Properties.`
    );
    const r = PreVerifyGate.check('https://cortinaproperties.com', html, lead);
    expect(r.status).toBe('VERIFIED_SEMANTIC');
  });

  it('Andreotta → agenziaandreotta.it (Layer A or B)', () => {
    const lead = normalizeLead({
      company_name: 'Agenzia Andreotta',
      city: 'Belluno',
      category: 'agenzie immobiliari',
    });
    const html = htmlPage('Andreotta', `${realEstateBody} Andreotta a Belluno.`);
    const r = PreVerifyGate.check('https://agenziaandreotta.it', html, lead);
    expect(r.status).toBe('VERIFIED_SEMANTIC');
  });

  it('Agenzia Immobiliare SG → agenziaimmobiliaresg.it (Layer A — long compact full)', () => {
    const lead = normalizeLead({
      company_name: 'Agenzia Immobiliare SG',
      city: 'Belluno',
      category: 'agenzie immobiliari',
    });
    const html = htmlPage('SG', `${realEstateBody} SG a Belluno.`);
    const r = PreVerifyGate.check('https://agenziaimmobiliaresg.it', html, lead);
    expect(r.status).toBe('VERIFIED_SEMANTIC');
    expect(r.evidence).toBe('strong_full_name');
  });

  it('DMC Legno → dmclegno.it (Layer B accepts despite mis-categorised sector)', () => {
    // PG mis-categorises this carpentry firm as "agenzie immobiliari".
    // Layer B identity match must still accept — sector conflict is
    // tolerated when identity evidence is strong.
    const lead = normalizeLead({
      company_name: 'DMC Legno',
      city: 'Belluno',
      category: 'agenzie immobiliari',
    });
    const carpenteriaBody =
      'Falegnameria e carpenteria in legno con sede a Belluno. Realizziamo strutture ' +
      'in legno lamellare per edilizia, tettoie, pergolati, case in legno a Belluno. ' +
      'Lavorazioni di precisione del legno per progetti residenziali e commerciali. ' +
      ('Servizi di posa in opera in tutto il territorio bellunese. ' +
        'Realizziamo opere su misura per privati e imprese di costruzione. ').repeat(8);
    const html = htmlPage('DMC Legno', carpenteriaBody);
    const r = PreVerifyGate.check('https://dmclegno.it', html, lead);
    expect(r.status).toBe('VERIFIED_SEMANTIC');
  });
});
