# ONTOLOGIA CONCETTUALE DELLA FORZA COMMERCIALE D'IMPRESA
## System Document fondativo per un layer di intelligence a due assi (A: forza intrinseca di prodotto e narrativa · B: qualità dell'espressione digitale)

*Versione 2 — espansione concettuale. Nessun mapping a strumenti, nessun modello di scoring: ontologia pura.*

> **NOTA REPO (pg4)**: questo è l'artefatto canonico `ontology_version = v2`. È la fonte da cui `judgment_config` (src/judgment/config) viene trascritto riga per riga. Supera la v1 (566 righe). Ogni voce-logica del config deve citare la sezione di questo documento.

---

## TL;DR
- **La forza commerciale di un'azienda va misurata lungo DUE assi nettamente separati e con fonti diverse:** (A) la forza intrinseca del prodotto e della narrativa, da dedurre in prevalenza da **fonti terze/esterne** (registri, brevetti, premi, recensioni, stampa, fiere, distribuzione); (B) la qualità dell'**auto-espressione digitale** e del posizionamento, da valutare sul patrimonio "owned" e sui canali presidiati.
- **Il target ideale vive nel GAP: A alto + B basso** (potenziale inespresso e non monetizzato). La separazione è metodologicamente irrinunciabile perché, quando B è basso, A diventa invisibile ai soli segnali digitali auto-prodotti: per questo A va misurato con proxy esterni che sopravvivono al silenzio comunicativo dell'azienda.
- **L'AI a valle deve produrre due valutazioni indipendenti, poi ragionare sul divario A−B**, ponderare le superfici di B per modello di business (B2B/B2C/B2B2C) ed evitare le trappole cognitive che fanno fallire i sistemi a singolo asse (sito brutto ≠ prodotto debole; molti follower ≠ prodotto forte; survivorship bias; metriche B2C applicate al B2B).
- **Tre principi trasversali governano ogni giudizio:** la forza è sempre **relativa alla categoria** (un segnale è forte/debole solo rispetto alla mediana del settore); è sempre **una traiettoria**, non una fotografia (forte-stabile, forte-in-crescita e forte-in-declino sono target diversi); e ogni gap va **qualificato per causa** (omissione vs avversione vs vincolo vs declino) e **filtrato per disqualificatori** prima di diventare un target. Infine, ogni gap si traduce concettualmente in una **leva di intervento** (posizionamento, acquisizione, presidio/conversione, misurazione).

---

# PARTE 0 — INTRODUZIONE, FINALITÀ E ISTRUZIONI D'USO

## 0.1 Natura e scopo del documento
Questo è un **documento di ontologia concettuale pura**. La sua funzione è insegnare a un sistema di intelligenza artificiale *come* si valuta la forza commerciale di un'impresa: quali concetti esistono, come si manifestano concretamente, quali segnali osservabili testimoniano forza, debolezza o assenza, e quali inferenze logiche se ne traggono. Non descrive *con quali strumenti* operare: non contiene mapping a software specifici, non assegna pesi numerici, non definisce modelli di scoring. Queste dimensioni operative appartengono a iterazioni successive e sarebbero, in questa sede, premature e fuorvianti.

Il documento è concepito come **"system document" fondativo**: un layer di intelligence a valle ne deriverà prompt, guardrail e logica di analisi. Per questo motivo la struttura è deliberatamente gerarchica, navigabile e parsabile, costruita per essere letta e usata come riferimento da un'altra AI. Ogni concetto è trattato con la sequenza: **definizione rigorosa → manifestazioni concrete → segnali osservabili (forza / debolezza / assenza) → reperibilità da fonti terze**.

## 0.2 Il contesto strategico d'uso (orientamento del taglio)
Il sistema finale, a partire da una lista di aziende appartenenti a una data categoria merceologica, deve identificare il **target ideale**: aziende che possiedono un **prodotto forte e una narrativa forte** ma la cui **espressione digitale è assente, debole o mal posizionata**. Sono imprese il cui potenziale commerciale è **inespresso e non monetizzato**. L'opportunità di intervento — la ragione stessa per cui questa ontologia esiste — vive nel **divario (GAP)** tra la forza intrinseca dell'offerta e la qualità con cui essa viene espressa, comunicata e monetizzata digitalmente.

Questo orientamento determina il taglio dell'intero documento: non si tratta di trovare le aziende "migliori in assoluto", ma quelle in cui la distanza tra valore reale e valore espresso è massima e colmabile. Un'azienda perfetta in tutto non è un target; un'azienda forte ma silente lo è.

## 0.3 Il modello a due assi (principio architettonico)
L'intera ontologia è organizzata attorno a **due famiglie di segnali distinte, da non confondere mai**:

- **ASSE A — Forza intrinseca del prodotto e della narrativa.** È la qualità *reale* dell'offerta e della storia dell'azienda. Esiste indipendentemente da come l'azienda la comunica. È spesso desumibile da **fonti TERZE ed ESTERNE** (registro imprese, anzianità, dimensione, premi, brevetti, citazioni di terzi, distribuzione, reputazione di settore, recensioni scritte dai clienti, presenza in directory/cataloghi di settore, menzioni stampa). Il motivo di questo privilegio per le fonti terze è cruciale e va interiorizzato dal sistema: **un'azienda con auto-espressione debole non racconta bene sé stessa**, dunque i suoi segnali di forza vanno cercati fuori dal suo perimetro comunicativo.

- **ASSE B — Qualità dell'auto-espressione digitale e del posizionamento marketing.** È quanto bene l'azienda *esprime, comunica e monetizza* quella forza attraverso il proprio patrimonio digitale "owned" (di proprietà) e i canali che presidia.

## 0.4 Perché la separazione degli assi è metodologicamente irrinunciabile
La tentazione naturale di qualsiasi sistema automatico è **dedurre la forza del prodotto dalla qualità dei segnali digitali**: un bel sito, molti follower, contenuti curati vengono letti come prova di forza. Questo è un errore fatale per la missione, perché collassa i due assi in uno solo.

Il target perfetto ha **A alto e B basso**; ma proprio perché B è basso, **A è difficile da rilevare con i soli segnali digitali auto-prodotti**. Ne discende il principio operativo fondamentale dell'intera architettura:

> **A va misurato prevalentemente con proxy esterni/terzi; B va misurato con l'analisi del patrimonio owned e dei canali presidiati.**

Se l'AI cerca la forza del prodotto *dentro* l'espressione digitale dell'azienda, troverà sistematicamente "forte" solo chi è già maturo (A alto + B alto) e scarterà proprio il target ideale (A alto + B basso), classificandolo come debole. La separazione degli assi e la misura di A tramite proxy terzi sono, insieme, ciò che rende il sistema capace di **vedere l'invisibile**: la forza che non si auto-promuove.

## 0.5 Come l'AI a valle deve usare questo documento (protocollo)
1. **Trattare A e B come due valutazioni indipendenti**, condotte con fonti diverse e domande diverse. Non fonderle mai in un giudizio unico prima della fase finale sul divario.
2. **Per A, dare priorità ai segnali di terze parti**, perché sono gli unici che resistono all'assenza di auto-promozione. I segnali owned, per A, sono i meno affidabili.
3. **Per B, valutare per ogni superficie tre stati distinti**: eccellenza, mediocrità, assenza/abbandono — e saper sempre distinguere "assente" (la superficie non esiste) da "presente ma mal espresso" (esiste ma comunica male la forza).
4. **Pesare le superfici di B in funzione del modello di business** (B2B, B2C, B2B2C), senza meccanicismi.
5. **Applicare i tre principi trasversali** (relatività di categoria §1.4, traiettoria §1.5, qualificazione/disqualificazione del gap §4.4–4.5).
6. **Collocare l'azienda nella matrice del GAP** (Parte IV), confrontarla con gli archetipi (Parte VI), tradurre il gap in leva di intervento (Parte VII) e applicare le euristiche di ragionamento e le trappole cognitive (Parte V).

---

# PARTE I — IL PRINCIPIO ARCHITETTONICO DEI DUE ASSI (APPROFONDIMENTO)

## 1.1 Definizione formale dei due assi
**Asse A (Forza intrinseca):** l'insieme delle proprietà *reali* dell'offerta e della reputazione dell'impresa, che esistono indipendentemente da come l'impresa le comunica. Sono proprietà "ontologiche" del business e rispondono a domande come: cosa fa davvero, quanto è differenziato, quanto è difendibile, da quanto tempo esiste, con quale dimensione e trazione, chi lo riconosce dall'esterno, cosa dicono i clienti e i terzi.

**Asse B (Qualità dell'espressione):** l'insieme delle proprietà *comunicative e di presidio di mercato* attraverso cui l'impresa rende la propria forza visibile, comprensibile, desiderabile e acquistabile. Sono proprietà "fenomeniche" e rispondono a domande come: come appare, come racconta, dove è trovabile, quanto è coerente cross-canale, come converte, quanto investe in visibilità.

La distinzione è ontologica: A è *l'essere*, B è *l'apparire e il vendere*. Un'azienda può essere senza apparire (target ideale); può apparire senza essere (fuffa); può entrambe le cose o nessuna.

## 1.2 La natura e la tassonomia delle fonti
- **Fonti di tipo A (terze / esterne / non controllate dall'azienda):** registri pubblici e camerali; banche dati di brevetti e marchi; albi e associazioni di categoria; cataloghi e directory di settore; stampa e pubblicazioni editoriali specializzate; recensioni scritte dai clienti su piattaforme indipendenti; elenchi premi e certificazioni rilasciati da enti/giurie; cataloghi espositori delle fiere; citazioni di esperti e influencer di settore; dati su distribuzione ed export. **Caratteristica chiave: non sono prodotte (o non sono controllate) dall'azienda, quindi sopravvivono anche quando l'azienda non si auto-promuove.** Sono il cuore della rilevazione di A.

- **Fonti di tipo B (owned / presidiate):** sito web; blog e risorse; profili e contenuti social; scheda di presenza local; e-commerce proprietario; newsletter e audience email; presenza pubblicitaria. **Caratteristica chiave: sono espressione diretta della capacità comunicativa e di presidio dell'azienda.** Sono il cuore della rilevazione di B.

- **Fonti ibride (attraversano i due assi):** recensioni e reputazione (il *contenuto/valutazione* è proxy di A; la *gestione/recency* è proxy di B); PR e menzioni stampa (la *copertura ottenuta* è prova sociale di A; la *capacità di generarla e valorizzarla* è presidio di B); fiere (la *partecipazione* è segnale di A; l'*eco digitale* è presidio di B). La gestione corretta di queste fonti ibride — la loro "scomposizione" tra i due assi — è uno dei compiti analitici più delicati del sistema (vedi 3.4 e Parte V).

## 1.3 L'asimmetria informativa che genera l'opportunità
Il sistema sfrutta un'asimmetria strutturale: **le aziende con prodotto forte ma espressione debole *sotto-segnalano* sé stesse sui canali owned ma *vengono segnalate* dai terzi.** Il loro valore reale è quindi leggibile "in controluce": nei registri (anzianità, capitale, dipendenti, export), nelle recensioni genuine e non sollecitate, nelle menzioni stampa spontanee, nella presenza a fiere prestigiose, nei premi tecnici, nei brevetti. L'AI deve imparare a leggere questi segnali di forza *a dispetto* del silenzio digitale dell'azienda. È questa lettura controintuitiva — forza nonostante il silenzio — la competenza centrale che il documento intende installare.

## 1.4 Il principio di relatività di categoria (la forza è sempre relativa a un benchmark)
Il sistema non valuta aziende in astratto: parte da una **lista di imprese appartenenti a una stessa categoria merceologica**. Questo ha una conseguenza ontologica che deve governare ogni giudizio: **nessun segnale è "forte" o "debole" in assoluto; lo è solo rispetto alla norma della sua categoria.**

- Un sito mediocre in un settore dove tutti i concorrenti hanno siti eccellenti è un GAP; lo stesso sito in un settore dove tutti sono digitalmente arretrati è la norma e non distingue nulla.
- Tre recensioni sono pochissime per un ristorante, normali per un produttore di macchinari industriali su commessa.
- Un prezzo del +10% è premio modesto in un comparto di lusso, fortissimo pricing power in una commodity.

Implicazione operativa per l'AI: prima di giudicare una singola azienda, deve **costruire (anche implicitamente) il profilo mediano della categoria** su entrambi gli assi — il "pavimento" e il "soffitto" di quel settore — e poi misurare ogni azienda come **scarto** rispetto a quel benchmark. Il target ideale non è chi ha "A alto e B basso in assoluto", ma chi ha **A nettamente sopra la mediana di categoria e B nettamente sotto**. La categoria è il sistema di riferimento; l'azienda è il vettore di scarto.

**Corollario (il benchmark è gratis):** la stessa lista di categoria fornisce il benchmark senza costo aggiuntivo. Le aziende mature della lista (A alto + B alto) definiscono il "soffitto" dell'espressione possibile in quel settore; è rispetto a quel soffitto che si misura quanto è ampio il gap di un'azienda silente. Il sistema deve quindi analizzare la lista **come insieme**, non solo azienda per azienda: i pari servono a tarare la scala.

## 1.5 Il principio di traiettoria (lo stato statico non basta)
Entrambi gli assi vanno letti non solo come **fotografia** ma come **traiettoria**. Un'azienda forte e in crescita, un'azienda forte ma in declino e un'azienda forte e stabile pongono problemi di targeting diversi.

- **Su A**, la traiettoria si legge da proxy terzi: crescita/calo di dipendenti e fatturato negli anni, apertura/chiusura di sedi, ingresso/uscita da mercati export, brevetti recenti vs portafoglio fermo, premi recenti vs riconoscimenti solo datati.
- **Su B**, la traiettoria si legge dalla recency: profili abbandonati vs riattivati, ultimo aggiornamento del sito, recensioni che si addensano o si diradano, creatività pubblicitarie ferme da mesi.

Configurazioni rilevanti:
- **A alto stabile + B basso** → target classico: forza consolidata, mai espressa. Massima affidabilità del segnale.
- **A in crescita + B basso** → target ad alto potenziale: l'azienda sta vincendo *nonostante* il silenzio digitale; va immaginato cosa farebbe con espressione adeguata.
- **A in declino + B basso** → cautela: il gap potrebbe non essere causato dal silenzio, ma il silenzio potrebbe essere *sintomo* di un declino più profondo (sostanza che si sta erodendo). Distinguere "non comunica perché non gli serve" da "non comunica perché è in difficoltà".

L'AI deve quindi sempre chiedersi non solo "quanto è forte adesso" ma "in che direzione si sta muovendo", perché la direzione cambia il significato del gap.

---

# PARTE II — DIMENSIONE A: ONTOLOGIA DELLA FORZA DEL PRODOTTO E DELLA NARRATIVA

*Per ciascuna sotto-dimensione: definizione rigorosa, fondamenti teorici con autori e framework, manifestazioni concrete, segnali osservabili di forza/debolezza, e — punto cruciale — quali segnali sono reperibili da fonti TERZE anche in assenza di auto-promozione.*

## 2.1 Differenziazione e particolarità competitiva

### 2.1.1 Definizione
La differenziazione è la misura in cui un prodotto/azienda possiede attributi **unici e di valore** che le alternative competitive non offrono. È l'opposto della *commodity*, condizione in cui l'offerta è percepita come fungibile e la competizione si gioca esclusivamente sul prezzo. La differenziazione è la prima e più immediata manifestazione di forza intrinseca: rispondere alla domanda "cosa rende questo prodotto diverso?" è il punto di partenza di ogni valutazione di A.

### 2.1.2 Fondamenti teorici

**April Dunford — "Obviously Awesome".** Dunford definisce cinque (+1) componenti del posizionamento efficace, tra loro interdipendenti e da percorrere in ordine:
1. **Competitive alternatives** — cosa farebbe il cliente se il prodotto non esistesse (un altro prodotto, un assistente, il "non far nulla"). Sono il benchmark minimo.
2. **Unique attributes** — la "secret sauce": le capacità e le feature che il prodotto ha e che le alternative non hanno. Dunford insiste che gli attributi sono unici *solo in confronto* a un'alternativa competitiva reale: la differenziazione è sempre relazionale.
3. **Value (and proof)** — i benefici che quegli attributi abilitano, da **dimostrare con fatti o validazione di terzi**. Questo aggancio alla prova di terzi è direttamente rilevante per la nostra Dimensione A.
4. **Target market characteristics** — chi tiene di più a quel valore.
5. **Market category** — il contesto di mercato che rende ovvio il valore.
6. (Bonus) **Relevant trends** — i trend che rendono il prodotto rilevante "adesso", da usare con cautela.

Dunford osserva che un prodotto ben differenziato, se collocato nel contesto sbagliato (a competere contro le cose sbagliate), fallisce: il posizionamento è scelta deliberata di contesto.

**Kevin Lane Keller — Points of Difference (POD) vs Points of Parity (POP).** I **POD** sono associazioni *forti, favorevoli e uniche* che i clienti collegano al brand e che ritengono di non poter trovare nella stessa misura nei concorrenti. I **POP** sono associazioni non necessariamente uniche, condivise con altri brand, e rappresentano i requisiti *mandatori* per essere considerati un attore legittimo della categoria (il "biglietto d'ingresso"). Keller, con Sternthal e Tybout (2002), formula avvertenze decisive:
- senza i necessari POP, anche il più convincente POD non vince;
- investire troppo in POD *facilmente copiabili* attira i concorrenti invece di tenerli fuori (un brand che rivendica solo "il più economico" o "il più di moda" viene scavalcato);
- un buon POD dovrebbe essere qualcosa che **solo quell'azienda può fornire** (esempio classico: Volvo e la sicurezza).

**Philip Kotler — variabili e livelli di differenziazione.** Kotler enumera le dimensioni lungo cui un prodotto si differenzia: **forma, feature, performance quality, conformance quality, durata, affidabilità, riparabilità, stile, design, personalizzazione**; e per i servizi: facilità d'ordine, consegna, installazione, formazione del cliente, consulenza, manutenzione, resi. Aggiunge la differenziazione per **personale, canale, immagine**. I suoi **cinque livelli di prodotto** (core benefit, generic, expected, augmented, potential) mostrano che la differenziazione più forte avviene dal livello *augmented* in su: superare le aspettative, non solo soddisfarle.

**Al Ries & Jack Trout — "Positioning: The Battle for Your Mind" (1981).** In una "società sovra-comunicata" vince chi occupa per primo una **posizione** — una parola, un concetto — nella mente del prospect. Concetti-chiave: il **creneau** (il "buco" da occupare); la **ladder** (la scala mentale su cui i brand sono ordinati per categoria); il principio "**è meglio essere primi che essere migliori**"; la coerenza e la ripetizione come armi più della creatività; "**the essence of positioning is sacrifice**". Per chi non è primo: creare una nuova scala (nuovo creneau) o posizionarsi *contro* (la classica mossa "we try harder").

**Play Bigger (Ramadan, Peterson, Lochhead, Maney) — Category Design.** "**Different is greater than better**": l'errore più comune è concentrarsi sull'avere il prodotto "migliore" perdendo contro chi costruisce una categoria "diversa". I **category king** definiscono e dominano una nuova categoria invece di competere come versione migliore dell'esistente. Secondo la ricerca citata dagli autori, il category king cattura circa il **76% del valore (market cap) della categoria** — un framework che eleva la differenziazione da attributo di prodotto a *creazione di mercato*.

### 2.1.3 Manifestazioni concrete e segnali osservabili
- **Segnali di forza:** linguaggio di terzi che descrive l'azienda come "l'unica che…", "la prima a…", "lo specialista di…"; esistenza di una categoria/nicchia riconoscibile e attribuita all'azienda; descrizioni in directory che enfatizzano attributi tecnici unici; prezzo significativamente superiore alla media di categoria (proxy di POD percepito); brevetti e marchi che proteggono l'attributo unico.
- **Segnali di debolezza:** descrizioni generiche e intercambiabili con i concorrenti; assenza di qualsiasi attributo nominabile; competizione esplicita e unica sul prezzo; claim "tutto per tutti".
- **Reperibilità da fonti terze:** descrizioni nei cataloghi di settore, schede dei distributori, articoli di stampa specializzata, citazioni di esperti, voci enciclopediche. **Tutte descrivono il prodotto anche quando l'azienda tace sui propri canali.**

### 2.1.4 Differenziazione difendibile vs marginale
Una differenziazione è **difendibile** quando è difficile da imitare e radicata in asset o competenze (ponte verso 2.2: VRIO, moat). È **marginale** quando è facilmente replicabile (una singola feature, un prezzo, una "moda"). Keller e Ries/Trout convergono: chi si posiziona sul "più economico" o sul "più di moda" verrà scavalcato. L'AI deve quindi distinguere tra una particolarità *strutturale* (know-how, brevetto, eredità, processo) e una *cosmetica* (claim, packaging, slogan), assegnando peso di forza solo alla prima.

## 2.2 Vantaggio competitivo e difendibilità (moat)

### 2.2.1 Definizione
Il vantaggio competitivo è la capacità dell'impresa di **sostenere nel tempo** una redditività e una posizione superiori, difendendole dall'imitazione. Il **moat** (fossato) è la metafora resa celebre da Warren Buffett: come un castello protetto da un fossato, l'azienda con moat respinge gli "invasori" (concorrenti) per anni o decenni.

### 2.2.2 Fondamenti teorici

**Jay Barney — VRIO (evoluzione del VRIN, 1991→1995).** Una risorsa genera vantaggio competitivo *sostenibile* se è:
- **Valuable** — consente di sfruttare opportunità o neutralizzare minacce;
- **Rare** — scarsa sul mercato;
- **costly to Imitate** — costosa o difficile da imitare;
- **Organized** — l'impresa è organizzata (cultura, processi, sistemi) per sfruttarla.
La maggior parte delle risorse fallisce sui test di **rarità o imitabilità**: ecco perché poche aziende hanno vantaggi *sostenuti*. VRIO è uno sguardo *interno* (resource-based view), **complementare** a Porter che guarda alla struttura *esterna* del settore. Barney aggiunse la "O" (Organization) per catturare un fallimento frequente: aziende che possiedono risorse valide, rare e inimitabili ma mancano dei sistemi per sfruttarle.

**Morningstar — le cinque fonti di economic moat** (sistematizzazione del concetto di Buffett):
1. **Intangible assets** — brevetti, marchi, licenze regolatorie, brand identity.
2. **Switching costs** — costi, tempo, sforzo o "tassa psicologica" che rendono oneroso cambiare fornitore.
3. **Network effect** — il valore cresce all'aumentare degli utenti.
4. **Cost advantage** — struttura di costo strutturalmente inferiore (scala, processo, posizione, accesso a input).
5. **Efficient scale** — un mercato di nicchia servito efficientemente da uno o pochi attori.
Morningstar distingue **wide moat** (>20 anni) e **narrow moat** (~10 anni), e avverte: "**un marchio noto o una lunga storia non implicano automaticamente un moat**". Le fonti spesso coesistono e si rinforzano.

**Michael Porter — strategie generiche.** Due tipi base di vantaggio (costo inferiore o differenziazione) combinati con l'ampiezza del campo competitivo generano tre strategie: **cost leadership, differentiation, focus** (con varianti *cost focus* e *differentiation focus*). Chi non sceglie — lo "**stuck in the middle**" — rischia performance scadenti. Per le PMI di nicchia, la *differentiation focus* è spesso la strada naturale.

### 2.2.3 Segnali osservabili
- **Forza:** brevetti e marchi registrati; know-how proprietario citato da terzi; relazioni di canale esclusive; clientela "captive" (alti switching cost); longevità con redditività; posizione di efficient scale in una nicchia.
- **Debolezza:** nessun asset proprietario; offerta facilmente sostituibile; dipendenza da un solo cliente o canale senza esclusiva; redditività erosa da concorrenza di prezzo.
- **Reperibilità da fonti terze:** banche dati brevetti/marchi, atti e bilanci camerali (ove depositati), articoli che descrivono tecnologie o processi proprietari, presenza in consorzi e filiere. **Tutti accessibili senza alcuna auto-promozione dell'azienda.**

## 2.3 Narrativa e storicità del brand

### 2.3.1 Definizione
La narrativa è la **struttura di significato** che dà senso all'esistenza dell'azienda oltre la funzione del prodotto. Una narrativa "forte" è **autentica, ricca, distintiva e coerente**; una "debole" è assente, generica o puramente funzionale. La narrativa è la dimensione di A più difficile da falsificare e, al tempo stesso, quella che genera il legame emotivo e la disponibilità a pagare un premio.

### 2.3.2 Fondamenti teorici

**Simon Sinek — Golden Circle / "Start With Why".** Le organizzazioni che ispirano comunicano **dall'interno verso l'esterno**: prima il **Why** (scopo, causa, credo — non il profitto, che è un risultato), poi il **How** (il processo differenziante), infine il **What** (cosa si fa). Sinek collega *Why* e *How* al **cervello limbico** (emozioni, fiducia, decisione) e il *What* alla **neocorteccia** (razionale). Massima: "**People don't buy WHAT you do; they buy WHY you do it**". *Caveat:* il modello è influente ma criticato per la base prevalentemente aneddotica; va usato come lente euristica per *riconoscere* la presenza/assenza di uno scopo articolato, non come legge predittiva.

**Mark & Pearson — "The Hero and the Outlaw": i 12 archetipi di brand.** Fondati sulla teoria junghiana dell'**inconscio collettivo**, individuano dodici archetipi: **Innocente, Esploratore, Saggio, Eroe, Fuorilegge (Outlaw), Mago, Uomo Comune, Amante, Giullare, Caregiver, Creatore, Sovrano**. Un brand forte incarna in modo coerente un **archetipo dominante**; regola pratica diffusa: ~70% archetipo centrale + ~30% archetipo di differenziazione, per evitare una personalità confusa.

**Heritage brand, storicità e longevità.** Un **historical/heritage brand** fonda **deliberatamente** posizionamento e valore aggiunto sulla propria eredità, usando la storia come componente attiva dell'identità — **da non confondere con il nostalgic marketing**, che ne è solo un supporto comunicativo. La ricerca (es. studi su brand iconici italiani) identifica strategie di comunicazione del corporate heritage declinate in: *heritage for authenticity*, *heritage for market leadership*, *heritage for continuity*. Strumenti tipici: **origin story, manifesto, musei e archivi d'impresa, showroom storici**.

**Made in Italy e Country of Origin Effect.** Il "Made in Italy" agisce da Country of Origin Effect: evoca **creatività, estetica, qualità, sofisticazione e artigianalità**, creando un "valore differenziale" attraverso l'associazione prodotto-Paese. In Italia esiste, dal 2019, il **Registro speciale dei marchi storici di interesse nazionale**, che riconosce e protegge i marchi con valore culturale, storico e artistico. Rilevante anche lo **storytelling territoriale/terroir**, che radica il prodotto in una comunità e cultura specifiche.

**Le componenti di una narrativa forte (verità, nemico, filosofia):**
- **Verità** — autenticità verificabile, non costruita ad arte;
- **Nemico** — l'antagonista contro cui il brand si batte (lo status quo, l'omologazione, la bassa qualità);
- **Filosofia** — il principio guida, il "Why" sineckiano che precede e giustifica il "What".

### 2.3.3 Segnali osservabili
- **Forza:** anno di fondazione lontano e documentato; storia familiare/territoriale citata da terzi; iscrizione al registro marchi storici; musei/archivi d'impresa; menzioni stampa che raccontano la "storia"; appartenenza a distretti riconoscibili; archetipo riconoscibile e coerente.
- **Debolezza:** nessuna storia rintracciabile; comunicazione solo funzionale; claim generici; assenza di scopo o filosofia.
- **Reperibilità da fonti terze:** data di costituzione (registro imprese), iscrizione ai registri di marchi storici, articoli e voci enciclopediche, premi alla longevità, citazioni in libri e ricerche di settore, esistenza di musei/fondazioni. **La narrativa "vera" lascia tracce esterne anche quando l'azienda non la racconta sui propri canali** — caratteristica preziosa per individuare il target ideale.

## 2.4 Qualità intrinseca e percepita del prodotto

### 2.4.1 Definizione
Occorre distinguere due piani: la **qualità reale** (proprietà oggettive e verificabili) e la **qualità percepita** (la convinzione consolidata dei clienti e del mercato). David Aaker tratta la *perceived quality* come una delle componenti centrali del brand equity, capace di generare ragioni d'acquisto e capacità di prezzo premium.

### 2.4.2 Fondamenti teorici

**David Aaker — "Managing Brand Equity".** Il brand equity è l'insieme di asset (e passività) legati al brand. Cinque componenti:
1. **Brand loyalty** — impegno al riacquisto; riduce i costi di marketing, crea advocacy;
2. **Brand awareness** — riconoscibilità e richiamo;
3. **Perceived quality** — qualità percepita; leva centrale;
4. **Brand associations** — connessioni cognitive ed emotive col brand;
5. **Other proprietary assets** — brevetti, marchi, relazioni di canale.
Aaker nota l'interdipendenza: la perceived quality può essere influenzata dall'awareness, dalle associazioni e dalla loyalty.

**Indicatori di qualità reale:** materiali, processo produttivo, certificazioni (di prodotto e di processo), premi tecnici di settore, brevetti, conformità a standard.
**Indicatori di qualità percepita:** recensioni di terzi, reputazione, **word of mouth**, **NPS**, testimonianze.

### 2.4.3 Segnali osservabili
- **Forza:** certificazioni di prodotto/processo; premi tecnici; recensioni clienti numerose, recenti e positive; word of mouth verificabile; clienti che citano spontaneamente la qualità; NPS elevato (ove disponibile).
- **Debolezza:** assenza di certificazioni; recensioni scarse, vecchie o negative; reclami ricorrenti sulla qualità.
- **Reperibilità da fonti terze:** certificazioni (enti certificatori), premi (giurie e associazioni), recensioni su piattaforme indipendenti, test comparativi di stampa specializzata. **La qualità reale lascia tracce documentali esterne** indipendenti dall'auto-promozione.

## 2.5 Profondità e coerenza dell'offerta + pricing power

### 2.5.1 Definizione
Riguarda l'**ampiezza e coerenza della gamma**, il grado di **specializzazione/nicchia** e — segnale particolarmente potente — il **pricing power**, cioè la capacità di sostenere prezzi premium senza perdere domanda. Il pricing power è considerato una delle manifestazioni più affidabili di forza intrinseca.

### 2.5.2 Fondamenti teorici

**Pricing power come manifestazione del vantaggio competitivo.** La capacità di alzare o mantenere i prezzi senza perdere clienti riflette differenziazione, forza del brand, dominio di mercato o assenza di sostituti. Brand forti comandano prezzi premium e **riducono la price sensitivity**. Warren Buffett: "**The single most important decision in evaluating a business is pricing power**". Il pricing power è distinto dal cost-plus e dal competitive pricing: consente di fissare i prezzi *indipendentemente*, in base al valore percepito.

**Specializzazione e focus.** Porter (focus strategy) e Ries/Trout (creneau, logica "big fish in a small pond") indicano che la **profondità su una nicchia** è spesso più difendibile dell'ampiezza generalista. La coerenza dell'offerta è essa stessa segnale di forza; la dispersione incoerente segnala debolezza strategica.

### 2.5.3 Segnali osservabili
- **Forza:** prezzi di listino significativamente superiori alla media di categoria, sostenuti nel tempo; posizionamento premium attribuito da terzi; gamma coerente e specializzata; assenza di sconti aggressivi e continui; bassa frequenza promozionale.
- **Debolezza:** prezzi sempre allineati al minimo; gamma incoerente o dispersa; promozioni continue; win-rate dipendente dallo sconto.
- **Reperibilità da fonti terze:** listini presso distributori e rivenditori, prezzi su marketplace, comparazioni di terzi, posizionamento in fasce premium nei cataloghi. **Il prezzo è osservabile anche dove l'azienda non comunica.**

## 2.6 Validazione di mercato e trazione reale

### 2.6.1 Definizione
L'insieme delle prove che il mercato ha **realmente adottato e premiato** l'offerta nel tempo: anzianità, dimensione (dipendenti, fatturato come proxy disponibili da registri), base clienti, partnership e distribuzione, export, clienti-insegna prestigiosi, fidelizzazione.

### 2.6.2 Fondamenti teorici

**Geoffrey Moore — "Crossing the Chasm" / Technology Adoption Lifecycle.** Il mercato adotta per fasi successive: **innovators, early adopters, early majority, late majority, laggards**. Tra early adopters ed early majority si apre un "**chasm**" che molte offerte non superano. La strategia vincente è **dominare una nicchia-testa di ponte ("beachhead") prima di espandersi**. Implicazione: **chi domina anche un piccolo segmento ha una trazione reale superiore a chi è genericamente diffuso ma marginale ovunque.** La dominanza di nicchia è dunque un proxy forte di validazione.

**Anzianità e dimensione come proxy di validazione.** La **longevità con continuità operativa** è di per sé un segnale: il mercato ha *continuato a scegliere* l'azienda anno dopo anno. La **dimensione** è proxy della scala raggiunta. L'**export** verso più mercati segnala validazione internazionale — particolarmente significativo per le PMI Made in Italy.

### 2.6.3 Segnali osservabili
- **Forza:** molti anni di attività continuativa; crescita di dipendenti/fatturato; export verso più mercati; clienti-insegna prestigiosi citati; partnership e accordi di distribuzione; fidelizzazione; dominanza riconoscibile di una nicchia.
- **Debolezza:** azienda neonata priva di trazione; dimensione stagnante o calante; nessun cliente prestigioso o partnership; dipendenza da un mercato unico fragile.
- **Reperibilità da fonti terze:** registro imprese (data di costituzione, capitale sociale, dipendenti, bilanci ove depositati), banche dati su export, elenchi clienti pubblicati sui siti dei partner, comunicati di accordi commerciali, presenza nelle filiere. **Tutta validazione leggibile dall'esterno.**

## 2.7 Riconoscimenti esterni e prove sociali di terzi

### 2.7.1 Definizione
Il "sigillo" che attori terzi e autorevoli appongono sull'azienda: **premi, certificazioni, menzioni stampa, citazioni di esperti/influencer di settore, appartenenza ad associazioni di categoria, presenza in fiere di prestigio**. È la sotto-dimensione di A più direttamente "esterna" e quindi più preziosa quando B è silente.

### 2.7.2 Fondamenti teorici
**Prova sociale e validazione di terzi.** Dunford include esplicitamente la *proof* (prova del valore tramite fatti o validazione di terzi) come parte del componente "value": il valore va dimostrato, e la dimostrazione più credibile viene da fonti indipendenti. Aaker tratta i riconoscimenti come rinforzo della *perceived quality* e delle *brand associations*.

**Fiere ed eventi di settore.** La partecipazione a fiere prestigiose funziona come **segnale di serietà del prodotto e di investimento/impegno** (signaling): esporre richiede risorse, impegno e una proposta presentabile a un pubblico professionale qualificato. È rilevante soprattutto per il **B2B e il manifatturiero/Made in Italy**. *Caveat:* il nesso specifico "partecipazione a fiera → credibilità del prodotto" è qui formulato come **ipotesi di settore robusta ma non ancorata, in questa fase, a una singola fonte accademica nominata**: trattarlo come euristica forte da validare, non come affermazione provata.

### 2.7.3 Segnali osservabili
- **Forza:** premi di settore; certificazioni rilasciate da enti riconosciuti; menzioni su testate autorevoli; citazioni di esperti/influencer di settore; appartenenza ad associazioni di categoria; presenza ricorrente a fiere di prestigio.
- **Debolezza:** nessun riconoscimento esterno; assenza da fiere e associazioni; nessuna menzione stampa.
- **Reperibilità da fonti terze:** albi premi, registri delle associazioni, archivi stampa, cataloghi espositori delle fiere. **Per definizione tutti esterni all'azienda: sono il cuore della rilevazione di A quando B è silente.**

## 2.8 Declinazione dell'Asse A per modello di business e settore
Le sette sotto-dimensioni di A (differenziazione, moat, narrativa, qualità, pricing/coerenza, validazione, riconoscimenti) sono universali, ma **cosa le rende osservabili e quanto pesano cambia con il modello di business e il settore**. Misurare la forza di un produttore di macchinari con la lente di un ristorante (o viceversa) genera falsi giudizi. Questa sezione fornisce le declinazioni; il principio di relatività di categoria (1.4) resta sovraordinato.

### 2.8.1 B2B manifatturiero / industriale (meccanica, impiantistica, componentistica, arredo di nicchia)
- **Dove vive la forza:** brevetti e know-how di processo; certificazioni tecniche e di sistema; capitolati e omologazioni; clienti-insegna e fornitura a filiere prestigiose; export; presenza a fiere verticali; anzianità e appartenenza a distretti.
- **Proxy terzi privilegiati:** registri camerali (anzianità, dimensione, export), banche dati brevetti/marchi, cataloghi espositori fiere, schede dei distributori, stampa tecnica di settore. Le recensioni consumer pesano poco; pesa la reputazione *tra pari e clienti professionali*.
- **Segnale di forza controintuitivo:** un'azienda che fornisce componenti a marchi finali prestigiosi (anche se sconosciuta al pubblico) ha A altissimo pur essendo digitalmente invisibile — è la firma perfetta del target.

### 2.8.2 B2C di prodotto (beni fisici a marchio proprio: food, moda, design, cosmesi, artigianato)
- **Dove vive la forza:** qualità percepita e word of mouth; pricing power premium; riconoscibilità del brand; recensioni numerose e positive; presenza/posizionamento su marketplace; eventuale heritage e Made in Italy.
- **Proxy terzi privilegiati:** recensioni su piattaforme indipendenti e marketplace (contenuto = qualità percepita), prezzi presso rivenditori, premi di prodotto, menzioni su stampa di settore/lifestyle, registro marchi storici.
- **Nota:** qui le recensioni consumer sono un proxy di A molto più potente che nel B2B, perché la base clienti è ampia e recensisce.

### 2.8.3 Servizi professionali locali ad alto valore (studi medici/dentistici, poliambulatori, studi tecnici, centri specializzati)
- **Dove vive la forza:** competenza e credenziali dei professionisti; specializzazione clinica/tecnica; reputazione locale e passaparola; risultati e casistica; affiliazione a network o titolarità accademica.
- **Proxy terzi privilegiati:** recensioni locali (Google in primis), albi professionali, pubblicazioni/relazioni a convegni, riconoscimenti di categoria. La "narrativa" è spesso legata alla **persona** (il professionista) più che all'azienda.
- **Caveat di settore:** in alcuni di questi ambiti la comunicazione è soggetta a **vincoli normativi/deontologici** (es. sanità): un'espressione marketing prudente può essere una scelta obbligata, non un gap — distinguere il silenzio *imposto* dal silenzio *subìto*.

### 2.8.4 Hospitality e retail multi-sede (ristorazione, ricettività, catene locali, negozi con più punti vendita)
- **Dove vive la forza:** qualità dell'esperienza; volume e media delle recensioni; reputazione e ritorno della clientela; riconoscibilità dell'insegna; coerenza tra sedi.
- **Proxy terzi privilegiati:** recensioni su Google/TripAdvisor (volume, media, recency, sentiment), guide di settore, menzioni stampa locale. Qui volume e freschezza delle recensioni sono tra i proxy di A più affidabili e scalabili.
- **Specificità multi-sede:** la forza si valuta anche sulla **coerenza tra le sedi** (un'insegna forte ha qualità e reputazione omogenee; sedi con reputazione molto disomogenea segnalano fragilità del "sistema").

### 2.8.5 B2B2C e modelli ibridi (produttori che vendono sia a distributori/retail sia al consumatore finale; brand presenti in GDO e in canali propri)
- **Doppia lettura della forza:** verso il canale (relazioni di distribuzione, presenza nei cataloghi dei rivenditori, accordi) **e** verso il consumatore finale (recensioni, riconoscibilità di marca, presenza a scaffale/marketplace).
- **Proxy terzi privilegiati:** entrambi i set — schede dei distributori per il lato canale; recensioni e marketplace per il lato consumer. La forza più solida è quella che si conferma su *entrambi* i lati.

### 2.8.6 Regola di sintesi
Per ogni azienda, prima di valutare A, l'AI deve **classificare il modello di business** e selezionare il set di proxy terzi pertinente e i loro pesi relativi. La domanda non è "questa azienda ha le prove di forza che mi aspetto in astratto?" ma "ha le prove di forza che ci si aspetterebbe **da un'eccellenza del suo specifico modello e settore**?".

---

# PARTE III — DIMENSIONE B: ONTOLOGIA DELLA QUALITÀ DELL'ESPRESSIONE DIGITALE E DEL POSIZIONAMENTO MARKETING

## 3.0 Principio di valutazione a tre stati e ponderazione per modello di business

### 3.0.1 I tre stati di ogni superficie
Per **ogni** superficie l'AI valuta tre stati distinti:
- **Eccellenza** — la superficie esprime bene e monetizza la forza dell'azienda;
- **Mediocrità** — la superficie esiste ma comunica in modo confuso, generico, incostante o datato;
- **Assenza/abbandono** — la superficie non esiste o è ferma da tempo.

E deve sempre distinguere due situazioni che un sistema ingenuo confonderebbe:
- **"Assente"** = la superficie non esiste affatto;
- **"Presente ma mal espresso"** = la superficie esiste ma NON comunica la forza reale dell'azienda (firma tipica del target ideale, A alto + B basso).

### 3.0.2 Ponderazione per modello di business (orientamento, non scoring)
I **pesi relativi** delle superfici cambiano con il modello di business:
- **B2C:** pesano di più Instagram, TikTok, marketplace/e-commerce, recensioni Google/Trustpilot/TripAdvisor, advertising. La decisione d'acquisto è spesso emotiva, rapida, influenzata da visual e social proof.
- **B2B:** pesano di più **LinkedIn** (azienda e founder/management), **sito web** professionale, **SEO**, **fiere** e **recensioni/reputazione di settore**. Il ciclo di vendita è lungo e razionale, costruito su fiducia e thought leadership. Instagram/TikTok contano meno ma non sono nulli.
- **B2B2C:** logica **ibrida** — presidio sia dei canali verso il consumatore finale sia di quelli verso partner/distributori.

**Fondamento delle ponderazioni e avvertenza anti-meccanicismo.** La letteratura di digital marketing converge nel collocare **LinkedIn come canale primario B2B** e **Instagram/TikTok come canali primari B2C**. Tuttavia un dato sfumante è decisivo: analisi su centinaia di brand B2B mostrano che essi hanno su LinkedIn la **più grande audience** ma ottengono un **engagement nettamente più alto su Instagram** — segno che i pesi vanno applicati con cautela, mai meccanicamente, e che "canale primario per il modello" non significa "unico canale rilevante". L'AI deve usare i pesi come priori da aggiornare con l'evidenza, non come regole rigide.

## 3.1 Sito web

### 3.1.1 Cosa significa essere ben posizionati
Il sito è il **quartier generale digitale** e, in molti casi, la prima impressione. Eccellenza significa: messaggio e **value proposition chiari entro pochi secondi**; gerarchia informativa ordinata; copywriting coerente col brand e col tono; **mobile-friendliness**; velocità; presenza di **prove** (case study, testimonianze); **call-to-action** e percorso di conversione evidenti; professionalità percepita; freschezza/aggiornamento; **multilingua** per l'export.

### 3.1.2 Fondamenti teorici di messaggio
**Donald Miller — StoryBrand (SB7).** Il cliente è l'**eroe**, il brand è la **guida** (come Yoda per Luke, non il protagonista). Principio del "**grunt test**" / regola dei pochi secondi: un visitatore deve capire **subito** cosa offri, per chi e perché conta. Massima: "**A confused visitor will never become a customer**" e "clarity over cleverness". L'header deve contenere un **one-liner** che dichiara cosa fai e l'esito positivo per l'eroe; CTA chiare e dirette; un piano semplice in 3 passi che riduce l'attrito. Il Nielsen Norman Group rileva che gli utenti **abbandonano le pagine in 10-20 secondi** (spesso meno), il che rende la chiarezza immediata decisiva.

**Value proposition design.** La chiarezza vince sulla complessità: evitare termini vaghi ("innovativo", "leader di mercato"); spiegare cosa fa la soluzione e perché conta, nel **linguaggio del cliente**; mappare l'offerta sui **job, pain e gain** del cliente.

### 3.1.3 Segnali
- **Eccellenza:** value proposition immediata; design curato e coerente; prove e testimonianze; CTA chiare e percorso di conversione; multilingua; veloce e mobile-first; aggiornato.
- **Mediocrità:** sito esistente ma messaggio confuso/generico, gergo eccessivo, prove assenti, CTA deboli, lentezza, scarsa coerenza visiva, contenuti datati.
- **Assenza/abbandono:** nessun sito; oppure sito non aggiornato da anni, link rotti, copyright datato, contenuti placeholder, "sito vetrina" fermo.
- **"Assente" vs "mal espresso":** assente = nessun dominio/sito attivo; mal espresso = sito presente che **non comunica la forza reale** (tipico del target con A alto e B basso).

## 3.2 SEO e visibilità organica nei motori di ricerca

### 3.2.1 Cosa significa
Essere **trovabili** quando qualcuno cerca la categoria merceologica o il brand. Comprende: presenza nei risultati, copertura di **keyword di categoria** e di **brand**, autorevolezza percepita, contenuti di valore (blog/risorse), struttura del sito.

### 3.2.2 Fondamento e distinzione concettuale
Quando un potenziale cliente cerca la *categoria* (non il nome dell'azienda), un'impresa è "trovabile" se compare; è "invisibile" se esiste solo per chi ne conosce già il nome esatto. **Un'azienda forte ma SEO-invisibile sulle keyword di categoria è un classico segnale di GAP** (A alto, B basso). I contenuti di valore contribuiscono sia alla trovabilità sia all'autorevolezza percepita.

### 3.2.3 Segnali
- **Eccellenza:** presenza nei risultati per keyword di categoria *e* di brand; contenuti/risorse di valore; struttura solida; autorevolezza percepita.
- **Mediocrità:** trovabile solo per il nome esatto del brand, invisibile sulle keyword di categoria; contenuti scarni o assenti.
- **Assenza/abbandono:** invisibile anche sul proprio nome; nessun contenuto indicizzabile.

## 3.3 Google Business Profile / presenza local

### 3.3.1 Cosa significa
Esistenza e **completezza della scheda local**, foto, recensioni e **risposta alle recensioni**, accuratezza delle informazioni (orari, indirizzo, contatti). Rilevante soprattutto per business locali e multi-sede.

### 3.3.2 Fondamento di rilevanza
La ricerca sul comportamento del consumatore locale indica che la **stragrande maggioranza dei consumatori legge le recensioni prima di scegliere un'attività locale** e che **Google è la piattaforma dominante**. Le **informazioni inesatte o incoerenti erodono la fiducia**. Le foto aumentano richieste di indicazioni e click al sito.

### 3.3.3 Segnali
- **Eccellenza:** scheda completa, foto curate e aggiornate, recensioni numerose e **gestite con risposte**, informazioni accurate.
- **Mediocrità:** scheda esistente ma incompleta, poche foto, recensioni non gestite.
- **Assenza/abbandono:** nessuna scheda, o scheda non rivendicata, informazioni errate/incoerenti.

## 3.4 Recensioni e reputazione su piattaforme terze

### 3.4.1 Cosa significa
**Volume, valutazione media, recency (freschezza), sentiment, gestione delle risposte** su Google, Trustpilot, TripAdvisor, recensioni di settore, marketplace.

### 3.4.2 La doppiezza del segnale (nodo concettuale cruciale)
Le recensioni sono un **segnale IBRIDO** che attraversa entrambi gli assi e va "scomposto":
- **Lato A (forza del prodotto):** il **contenuto** e la **valutazione** delle recensioni testimoniano la **qualità reale percepita** dai clienti — prova sociale di terzi, leggibile anche se l'azienda non si auto-promuove.
- **Lato B (presidio marketing):** la **gestione** delle recensioni — sollecitazione, volume recente, risposte, recency — testimonia il **presidio attivo** del marketing.

Operativamente, l'AI deve usare **valutazione/sentiment/contenuto come proxy di A** e **gestione/risposte/recency come proxy di B**. Configurazione diagnostica chiave: **un'azienda con molte recensioni spontanee molto positive ma nessuna risposta e nessuna sollecitazione strutturata è un fortissimo indizio di A alto + B basso** — il prodotto è amato (A), ma nessuno presidia e amplifica quella reputazione (B). Una delle "firme" più affidabili del target ideale.

### 3.4.3 Segnali
- **Eccellenza:** volume elevato, media alta, recensioni recenti, sentiment positivo, risposte curate e tempestive.
- **Mediocrità:** poche recensioni o datate; nessuna risposta; gestione assente.
- **Assenza/abbandono:** nessuna recensione, o reputazione negativa non gestita.

## 3.5 Instagram

### 3.5.1 Cosa significa
Presenza, **coerenza visiva e di brand**, qualità dei contenuti, frequenza, dimensione *e qualità* della community, **engagement reale vs vanity**, uso strategico vs occasionale, capacità di raccontare prodotto e narrativa.

### 3.5.2 Segnali
- **Eccellenza:** identità visiva coerente; contenuti di qualità; frequenza costante; **engagement reale** (commenti, salvataggi, condivisioni, non solo like); capacità di raccontare prodotto e storia.
- **Mediocrità:** presenza incostante; contenuti scadenti o incoerenti; engagement basso rispetto al numero di follower.
- **Assenza/abbandono:** profilo inesistente o fermo da mesi/anni.
- **Nota anti-vanity (cfr. Parte V):** molti follower con basso engagement **non** indicano forza; vanno valutati engagement reale e qualità, non i numeri assoluti. Per i brand B2B "un account Instagram mal eseguito può danneggiare la reputazione più dell'assenza".

## 3.6 TikTok

### 3.6.1 Cosa significa
Presenza, **comprensione del linguaggio nativo** della piattaforma, qualità e originalità dei contenuti, trazione.

### 3.6.2 Segnali
- **Eccellenza:** contenuti nativi e originali; padronanza dei codici della piattaforma; trazione reale.
- **Mediocrità:** contenuti riciclati da altre piattaforme; linguaggio non nativo; scarsa trazione.
- **Assenza/abbandono:** nessuna presenza (spesso **normale e non penalizzante nel B2B** — vedi trappola 5.3.4).

## 3.7 YouTube

### 3.7.1 Cosa significa
Presenza, qualità dei contenuti, uso per **spiegare prodotto/brand** (demo, tutorial, dietro le quinte, storytelling, contenuti long-form).

### 3.7.2 Segnali
- **Eccellenza:** contenuti curati che spiegano prodotto e brand; uso strategico (demo, tutorial, webinar).
- **Mediocrità:** pochi video datati, bassa qualità produttiva.
- **Assenza/abbandono:** canale inesistente o abbandonato.

## 3.8 LinkedIn (azienda e founder/persone chiave)

### 3.8.1 Cosa significa
Presenza e **completezza della pagina aziendale**, attività e **thought leadership**, presenza e **autorevolezza del founder/management**, dimensione e qualità del network, **employer branding**. **Peso elevato nel B2B.**

### 3.8.2 Fondamento
LinkedIn è riconosciuto come il **canale primario del B2B** ed è "lo standard aureo" per networking professionale, leadership insight e credibilità di brand. L'**autorevolezza del founder/management** è una leva di thought leadership particolarmente potente nel B2B: "l'influenza non riguarda la reach ma la rilevanza".

### 3.8.3 Segnali
- **Eccellenza:** pagina completa e attiva; thought leadership costante; founder/manager autorevoli e attivi; network ampio e qualificato; employer branding curato.
- **Mediocrità:** pagina esistente ma inattiva; founder assente o passivo; contenuti puramente promozionali.
- **Assenza/abbandono:** nessuna pagina aziendale; nessuna presenza del management. **Per un'azienda B2B forte, l'assenza da LinkedIn è un fortissimo segnale di B basso** (e quindi potenziale GAP).

## 3.9 Marketplace ed e-commerce di terzi (Amazon, eBay, Etsy, marketplace verticali)

### 3.9.1 Cosa significa
Presenza, **qualità delle schede prodotto**, recensioni, posizionamento competitivo sui marketplace rilevanti per la categoria.

### 3.9.2 Segnali
- **Eccellenza:** schede curate e complete; recensioni positive; buon posizionamento competitivo.
- **Mediocrità:** schede povere; recensioni scarse; posizionamento debole.
- **Assenza/abbandono:** assenza dai marketplace rilevanti per la categoria (penalizzante soprattutto nel B2C/prodotto fisico; spesso irrilevante nel B2B di servizi o macchinari custom).

## 3.10 E-commerce proprietario

### 3.10.1 Cosa significa
Esistenza, qualità, **esperienza d'acquisto**, integrazione con il brand.

### 3.10.2 Segnali
- **Eccellenza:** e-commerce curato, esperienza d'acquisto fluida, pienamente integrato col brand.
- **Mediocrità:** e-commerce presente ma scomodo, lento o mal integrato.
- **Assenza/abbandono:** nessun e-commerce dove la categoria lo richiederebbe (penalizzante nel B2C di prodotto; valutare caso per caso nel B2B).

## 3.11 Pubblicità a pagamento e ad transparency

### 3.11.1 Cosa significa
**Presenza o assenza di campagne attive** e loro sofisticazione apparente. Concettualmente, le **librerie pubbliche degli annunci** rendono osservabili gli annunci attivi di un'azienda: la **Meta Ad Library** (database pubblico e ricercabile degli annunci attivi su Facebook/Instagram/Messenger/Threads, con creatività, date di run, regioni) e il **Google Ads Transparency Center** (annunci verificati su Search, YouTube, Display, Gmail). Da queste librerie si può inferire: se l'azienda fa advertising, con quali formati, con quante varianti, con quale frequenza di refresh.

### 3.11.2 Segnale-chiave per la missione
**L'ASSENZA di advertising in un'azienda con prodotto forte è un segnale-chiave di potenziale inespresso.** Un'azienda con A alto che non investe in advertising sta lasciando valore **non monetizzato** sul tavolo: è precisamente il profilo del target ideale. Viceversa, la presenza di molte campagne attive, con varianti creative e refresh frequente, indica un **presidio marketing maturo** (B alto). La frequenza di aggiornamento delle creatività è un indizio diretto: refresh ogni 1-2 settimane = team maturo; stessa creatività ferma da mesi = account "in autopilot" o trascurato.

### 3.11.3 Segnali
- **Eccellenza:** campagne attive, varianti creative multiple, refresh frequente, presenza coordinata su più piattaforme.
- **Mediocrità:** poche campagne, creatività ferma da mesi (autopilot).
- **Assenza/abbandono:** nessun annuncio nelle librerie pubbliche.

## 3.12 Email marketing e owned audience

### 3.12.1 Cosa significa
Presenza di **newsletter, lead magnet, capacità di nurturing**. È concettualmente l'unico canale "owned" sul *pubblico* (la relazione non è mediata e revocabile da piattaforme terze), e quindi un asset di B particolarmente pregiato.

### 3.12.2 Segnali
- **Eccellenza:** newsletter attiva; lead magnet che catturano contatti; percorsi di nurturing.
- **Mediocrità:** newsletter presente ma sporadica o senza strategia; raccolta contatti senza valorizzazione.
- **Assenza/abbandono:** nessuna raccolta di audience owned.

## 3.13 PR, menzioni stampa e presenza editoriale digitale

### 3.13.1 Cosa significa
**Copertura mediatica** e **autorevolezza delle testate**. Nodo bidimensionale: la copertura *ottenuta* è anche prova sociale di A (cfr. 2.7), ma la **capacità di generare e valorizzare** PR (ufficio stampa attivo, presenza editoriale curata) è presidio di B.

### 3.13.2 Segnali
- **Eccellenza:** copertura su testate autorevoli; presenza editoriale curata; ufficio stampa attivo e proattivo.
- **Mediocrità:** menzioni sporadiche su testate marginali; nessuna valorizzazione delle menzioni ottenute.
- **Assenza/abbandono:** nessuna copertura.

## 3.14 Fiere ed eventi (e loro proiezione digitale)

### 3.14.1 Cosa significa
La partecipazione a fiere di settore è **insieme** segnale di serietà del prodotto (asse A — cfr. 2.7) **e** superficie di espressione (asse B). Su B conta soprattutto la loro **eco digitale**: come l'azienda proietta online la presenza fieristica (annunci di partecipazione, contenuti dallo stand, dirette, follow-up post-fiera).

### 3.14.2 Segnali
- **Eccellenza:** partecipazione a fiere di prestigio + **forte proiezione digitale** (contenuti pre/durante/post, comunicazione coordinata).
- **Mediocrità:** partecipazione **senza alcuna eco digitale** — configurazione diagnostica tipica del target A alto / B basso: l'azienda è seria abbastanza da esporre, ma non sa (o non si cura di) amplificarlo online.
- **Assenza/abbandono:** né presenza fieristica né eco.

## 3.15 Coerenza cross-canale e identità di marca

### 3.15.1 Cosa significa
Quanto **posizionamento, messaggio, identità visiva e tono** sono coerenti tra tutte le superfici, oppure frammentati/incoerenti. Ries/Trout e Keller insistono sulla **coerenza** come condizione per occupare e *mantenere* una posizione nella mente del prospect.

### 3.15.2 Segnali
- **Eccellenza:** identità visiva, messaggio e tono coerenti su tutti i canali; un'unica "voce" riconoscibile.
- **Mediocrità:** coerenza parziale; alcuni canali allineati, altri no.
- **Assenza/abbandono:** frammentazione totale; canali che sembrano appartenere ad aziende diverse.

## 3.16 Principi trasversali di brand/messaging review
Per valutare qualitativamente contenuti e messaggio su **qualsiasi** superficie, applicare sei criteri (sintesi da Dunford, Keller, Miller, Ries/Trout):
1. **Chiarezza** — si capisce subito cosa, per chi, perché conta? (grunt test);
2. **Distintività** — è diverso e riconoscibile rispetto ai concorrenti? (POD);
3. **Coerenza** — è allineato cross-canale e nel tempo?;
4. **Allineamento alla value proposition** — comunica il valore *reale* dell'azienda?;
5. **Qualità del copy** — usa il linguaggio del cliente, evita il gergo e i claim vuoti?;
6. **Prova/credibilità** — porta case study, testimonianze, dati, validazione di terzi?

---

# PARTE IV — LA TESI CENTRALE: LA MATRICE DEL GAP

## 4.1 Le quattro combinazioni
Incrociando l'**Asse A** (forza prodotto/narrativa: alto/basso) e l'**Asse B** (qualità espressione: alta/bassa) si ottengono quattro quadranti:

1. **A alto + B alto → Azienda già matura.** Forte e ben espressa. Scarso margine di intervento: non è il target. Sono le aziende che un sistema ingenuo, confondendo gli assi, identificherebbe erroneamente come "le migliori" su cui puntare — mentre offrono il minor spazio di crescita incrementale.

2. **A alto + B basso → TARGET IDEALE.** **Potenziale inespresso e non monetizzato.** La forza c'è (leggibile dai proxy terzi: anzianità, brevetti, premi, recensioni spontanee, fiere, export), ma l'espressione digitale è assente/debole/mal posizionata. È qui che vive l'opportunità: il **divario** tra valore reale e valore espresso è massimo e **colmabile**. È il cuore della missione.

3. **A basso + B alto → "Fuffa" / vanity.** Espressione brillante che riveste un prodotto debole. **Da evitare:** l'intervento amplificherebbe un vuoto, e l'azienda manca della sostanza per sostenere la crescita. È esattamente il profilo che un sistema ingenuo (bel sito, molti follower) scambierebbe per forte — il **falso positivo** più pericoloso.

4. **A basso + B basso → Non interessante.** Né forza né espressione. Nessun appiglio: né sostanza da valorizzare né presidio da correggere.

## 4.2 La logica del GAP
Il **valore di targeting** di un'azienda è funzione del **DIVARIO A−B**, non del livello assoluto di nessuno dei due. Il target ideale **massimizza (A − B) con A alto**. Concettualmente:
- non interessa l'azienda con A e B entrambi alti (divario nullo, già matura);
- non interessa quella con A e B entrambi bassi (divario nullo, nessuna sostanza);
- interessa al massimo grado quella con A alto e B basso (divario massimo positivo);
- va attivamente evitata quella con A basso e B alto (divario "negativo": sembra forte ma non lo è).

L'AI deve quindi calcolare **due valutazioni separate** e poi **ragionare sul loro divario**, MAI fondere i due assi in un unico giudizio indistinto. Il qualificatore "con A alto" è essenziale: A−B≈0 copre due quadranti opposti (maturo e inerte), che il divario da solo non distingue.

## 4.3 Perché un sistema a singolo asse fallisce
Un sistema che misuri solo segnali digitali (di fatto solo B, o B mascherato da A) commette **due errori simmetrici**:
- **Falsi negativi:** scarta i target ideali (A alto, B basso) perché "sembrano deboli" online;
- **Falsi positivi:** seleziona le "fuffe" (A basso, B alto) perché "sembrano forti" online.

La **separazione degli assi** e la **misura di A tramite proxy terzi** sono, insieme, l'unico antidoto a entrambi gli errori. È la giustificazione architettonica dell'intero documento.

## 4.4 Tassonomia delle cause del gap (non tutti i gap sono uguali)
Identificare che esiste un gap (A alto, B basso) non basta: conta **perché** esiste, perché la causa determina se il gap è **colmabile, attraente e a basso attrito**. L'AI deve inferire (con prudenza) la causa probabile e usarla per qualificare il target.

- **Gap da omissione/incuria** ("non ci hanno mai pensato / non hanno tempo"): l'azienda è assorbita dalla produzione e dalla domanda esistente (spesso da passaparola), e non ha mai presidiato il digitale. **Gap più attraente e colmabile:** nessuna resistenza ideologica, solo assenza. Profilo tipico del target ideale.
- **Gap da incompetenza/assenza di funzione** ("non sanno come si fa / nessun reparto marketing"): c'è apertura ma manca la competenza interna. **Molto colmabile**, anzi è esattamente lo spazio di un partner esterno.
- **Gap generazionale/di passaggio** ("azienda solida di vecchia generazione"): forza costruita in decenni, leadership poco digitale. Colmabile ma con possibile attrito culturale; spesso si sblocca con il ricambio generazionale o l'ingresso di figure più giovani.
- **Gap da scelta deliberata/avversione** ("non crede nel marketing / lo ritiene inutile o sconveniente"): resistenza attiva. **Gap meno colmabile**: la sostanza c'è ma manca la volontà; alto attrito di conversione.
- **Gap imposto da vincoli** (normativi, deontologici, di riservatezza B2B, di esclusiva di canale): il silenzio è **obbligato**, non subìto. **Da non scambiare per opportunità**: l'azienda non può (non solo non vuole) esprimersi liberamente.
- **Gap-sintomo di declino** (cfr. 1.5): il silenzio accompagna un'erosione della sostanza. **Trappola**: sembra un gap colmabile ma è il sintomo di un problema a monte.

Regola: il target di massimo valore è il gap **da omissione o da incompetenza, con A stabile o in crescita**. I gap da avversione, da vincolo o da declino vanno riconosciuti e declassati, anche a parità di A−B.

## 4.5 Red flags e disqualificatori (quando un'azienda NON è un target, a prescindere dal gap)
Indipendentemente dall'ampiezza del divario A−B, alcune condizioni **escludono** un'azienda dal targeting. L'AI deve trattarle come filtri di squalifica, non come semplici penalità. Integrano l'anti-profilo strategico del committente.

**Disqualificatori di sostanza (A non è davvero alto):**
- Differenziazione solo cosmetica, nessun asset proprietario, competizione esclusivamente di prezzo (commodity travestita).
- Prove di forza assenti su *tutti* i proxy terzi pertinenti al modello (vedi 2.8): non è un target silente, è semplicemente debole.

**Disqualificatori economici (il gap non è monetizzabile per il committente):**
- Margini strutturalmente troppo bassi per sostenere un investimento in espansione (l'economia dell'intervento non regge).
- Ticket/valore unitario così basso che nessuna conversione giustificherebbe l'acquisizione.
- Modello di puro arbitraggio/rivendita senza marca propria (non c'è sostanza-prodotto da esprimere, solo intermediazione).

**Disqualificatori di stadio:**
- Azienda pre-validazione di mercato (nessuna trazione reale): non si esprime un valore che non è ancora stato dimostrato. Il sistema cerca forza *inespressa*, non forza *inesistente o non ancora provata*.

**Disqualificatori di contesto/compliance:**
- Settori la cui comunicazione è incompatibile con i canali di espansione tipici (forti restrizioni regolatorie), dove il "gap" è strutturale e non aggredibile.

**Red flags di distress (sostanza a rischio):**
- Segnali di difficoltà rilevabili da fonti terze (procedure concorsuali, contenziosi rilevanti, chiusure di sedi, crollo di organico). Il silenzio digitale qui non è opportunità ma possibile sintomo.

**Red flags di reputazione falsificata (A apparente, non reale):**
- Recensioni che presentano pattern artificiali (picchi anomali, testi ripetitivi, sproporzione rispetto alla scala dell'azienda): la prova sociale è inquinata e non vale come proxy di qualità. L'AI deve trattare la reputazione sospetta come **segnale assente**, non come segnale positivo.

Principio: i disqualificatori operano **prima** della logica del gap. Un divario A−B ampio su un'azienda squalificata è un falso target.

---

# PARTE V — IL RAGIONAMENTO DELL'AI A VALLE: DOMANDE, INFERENZE, TRAPPOLE

## 5.1 Le domande che l'AI deve porsi, in ordine
1. **Su A (con priorità ai proxy terzi):** Quali tracce di forza esistono *fuori* dai canali owned dell'azienda? (registro imprese, brevetti/marchi, premi, certificazioni, recensioni spontanee, stampa, fiere, associazioni, distribuzione, export, anzianità, dimensione). Esiste una **differenziazione nominabile** (POD)? Esiste un **moat** (VRIO / fonti Morningstar)? Esiste una **narrativa** con tracce esterne (heritage, archetipo, Made in Italy)? È osservabile **pricing power**? L'azienda **domina una nicchia** (beachhead di Moore)?
2. **Su B (per superficie e per stato):** Per ogni superficie, lo stato è **eccellenza, mediocrità o assenza/abbandono**? È "assente" o "presente ma mal espresso"? I **pesi** sono corretti per il modello di business (B2B/B2C/B2B2C)?
3. **Sul GAP:** A è alto e B è basso? Quanto è ampio il divario rispetto alla mediana di categoria (§1.4)? Qual è la **traiettoria** (§1.5)? Qual è la **causa** del gap (§4.4)? L'azienda supera i **disqualificatori** (§4.5)? Quale **leva di intervento** sarebbe attivabile (Parte VII)?

## 5.2 Le inferenze tipiche (pattern diagnostici)
- Recensioni spontanee numerose e positive **+** nessuna risposta/sollecitazione → **A alto, B basso** (lato gestione reputazione).
- Presenza a fiere prestigiose **+** nessuna eco digitale → **A alto, B basso**.
- Anzianità **+** brevetti **+** export **+** sito fermo da anni → **A alto, B basso** (target).
- Assenza di advertising nelle librerie pubbliche **+** prodotto con premi/recensioni forti → **A alto, B basso** (potenziale non monetizzato).
- Bel sito **+** molti follower **+** nessun brevetto/premio/recensione di sostanza **+** prezzo da commodity → sospetto **A basso, B alto** ("fuffa").
- Prezzo premium sostenuto nel tempo **+** gamma coerente specializzata → indizio di **pricing power → A alto**.
- B2B senza Instagram/TikTok ma forte su LinkedIn/sito/fiere/reputazione → **NON** è debolezza: è un profilo coerente col modello (vedi trappola 5.3.4).

## 5.3 Le trappole cognitive da evitare
1. **Confondere un sito brutto con un prodotto debole.** Un sito scadente è segnale di **B basso**, NON di **A basso**. È spesso la *firma* del target ideale, non un motivo di scarto.
2. **Confondere molti follower con un prodotto forte.** I follower sono una **vanity metric**: gonfiabili (anche con acquisto), slegati da engagement, conversioni e vendite. Vanno valutati **engagement reale e qualità**, non i numeri assoluti. La regola pratica: un numero è "vanity" se non può guidare una decisione o un'azione.
3. **Survivorship bias.** Valutare solo le aziende già "visibili" digitalmente e ignorare quelle silenti **cancella per definizione il target ideale** (che è silente proprio perché B è basso). Bisogna cercare *attivamente* i silenti tramite proxy terzi, invertendo l'istinto del sistema.
4. **Penalizzare aziende B2B di nicchia con metriche B2C-centriche.** Un'azienda B2B eccellente può legittimamente non avere TikTok, Instagram o e-commerce, ed essere fortissima su LinkedIn, sito, fiere e reputazione di settore. Applicare pesi B2C a un B2B genera **falsi negativi**.
5. **Confondere "assente" con "presente ma mal espresso".** Sono stati diversi con implicazioni diverse: l'assenza totale di una superficie può essere normale (B2B senza TikTok) o un gap; la presenza mal espressa è quasi sempre un **gap colmabile** e un forte indizio di target.
6. **Fondere i due assi in un unico punteggio.** Distrugge l'informazione sul **GAP**, che è l'intera tesi. Tenere A e B sempre **separati** fino al ragionamento finale sul divario.
7. **Sopravvalutare i segnali auto-prodotti per stimare A.** Per A, i segnali owned sono i **meno affidabili** (un'azienda con B basso non li produce). Dare sistematicamente priorità ai **proxy terzi**.
8. **Scambiare la qualità della comunicazione per qualità del prodotto (e viceversa).** Sono assi ortogonali: un copy brillante non prova un prodotto forte; un copy scadente non prova un prodotto debole.
9. **Confondere un gap incolmabile con uno colmabile.** Un gap da avversione, da vincolo normativo o da declino (§4.4) somiglia a un gap da omissione ma ha esito opposto. Inferire sempre la *causa* prima di qualificare.
10. **Ignorare la traiettoria.** Un'azienda forte ma in declino con sito fermo non è lo stesso target di una forte e in crescita con sito fermo. La direzione cambia il significato del silenzio (§1.5).
11. **Valutare in assoluto invece che rispetto alla categoria.** Senza il benchmark di categoria (§1.4), "tre recensioni" o "+10% di prezzo" sono numeri privi di significato.

## 5.4 Regola aurea operativa (sintesi prescrittiva)
> Misura **A** prevalentemente con **fonti terze/esterne**; misura **B** con il **patrimonio owned e i canali presidiati**; **leggi sempre rispetto alla categoria e alla traiettoria**; **pondera B per modello di business**; cerca il **GAP** (A alto − B basso), poi **qualificane la causa** e **applica i disqualificatori**; **diffida dei numeri gonfiabili e dei bei contenitori vuoti**; **non scambiare mai il silenzio digitale per debolezza di prodotto**.

---

# PARTE VI — ARCHETIPI ILLUSTRATIVI (worked examples per quadrante)
Gli archetipi che seguono sono **profili-tipo astratti**, non aziende reali: servono a installare nel ragionamento dell'AI il *pattern* di ciascun quadrante della matrice. Per il quadrante target se ne forniscono diversi, perché è quello che il sistema deve saper riconoscere con la massima sensibilità.

## 6.1 Quadrante target (A alto + B basso) — i profili da cercare
- **Il fornitore silente della filiera.** Produttore B2B che fornisce componenti a marchi finali prestigiosi. Brevetti, certificazioni, decenni di attività, export. Sito vetrina fermo da anni, niente LinkedIn aziendale, nessuna pubblicità. *Firma:* A leggibile interamente da proxy terzi (filiera, brevetti, fiere); B quasi nullo. Gap da omissione. **Target di massimo valore.**
- **L'eccellenza artigiana di territorio.** Azienda di prodotto (food/design/moda) con heritage, Made in Italy, recensioni spontanee entusiaste, pricing premium accettato dal mercato. Instagram abbandonato, e-commerce assente o rudimentale, recensioni mai gestite. *Firma:* recensioni e prezzo = A alto; gestione e canali = B basso. **Target.**
- **Lo specialista locale autorevole.** Studio professionale o centro specializzato con reputazione e passaparola fortissimi, casistica e credenziali di rilievo. Google Business Profile incompleto, nessuna presenza editoriale, comunicazione minima (a volte per prudenza deontologica). *Firma:* reputazione locale = A alto; presidio = B basso. **Target — ma verificare se il silenzio è imposto (§4.4).**
- **Il campione di nicchia in crescita.** Azienda che sta conquistando un segmento (A in crescita), trazione evidente da dimensione/export crescenti, ma marketing inesistente. **Target ad alto potenziale** (§1.5).

## 6.2 Quadrante "fuffa" (A basso + B alto) — i falsi positivi da evitare
- **Il rivenditore brillante senza prodotto.** Dropshipper o puro intermediario con sito impeccabile, social curati, advertising aggressivo, molti follower. Nessun brevetto, nessuna marca propria, prezzo da commodity, recensioni sottili o gonfiate. *Firma:* B alto, A nullo. **Da evitare:** amplificare un vuoto. È il falso positivo che un sistema ingenuo premierebbe.
- **Il personal brand senza sostanza.** Forte presenza personale e narrativa accattivante, ma offerta indifferenziata e nessuna prova di terzi. **Da evitare.**

## 6.3 Quadrante maturo (A alto + B alto) — non target (poco margine)
- **Il brand consolidato e ben comunicato.** Forza reale *e* espressione eccellente su tutti i canali. Non c'è gap da colmare: il valore è già espresso e monetizzato. Margine di intervento incrementale basso. **Non target** (per la missione di trovare potenziale inespresso).

## 6.4 Quadrante inerte (A basso + B basso) — non interessante
- **L'attività marginale e silente.** Né sostanza né presidio. Nessun appiglio. **Non target.**

## 6.5 Come usare gli archetipi
L'AI non deve "incasellare" rigidamente, ma usare gli archetipi come **attrattori**: data un'azienda, chiedersi a quale profilo somiglia di più sui due assi, e in particolare se mostra la **firma del target** (forza leggibile da terzi + silenzio sui canali owned). La sensibilità verso il quadrante target e la diffidenza verso il quadrante fuffa sono le due competenze discriminanti del sistema.

---

# PARTE VII — DAL GAP ALLA LEVA DI INTERVENTO (lettura orientata all'offerta del committente)
Questa sezione collega, **concettualmente**, il *tipo* di gap rilevato al *tipo* di intervento che lo colmerebbe. Non contiene strumenti né procedure: traduce la diagnosi in **angolo di valore**, così che il layer a valle possa qualificare il target anche in base a *quale* leva sarebbe attivabile. I quattro tipi di leva ricalcano i pilastri tipici di un partner di crescita (strategia/posizionamento; acquisizione/contenuti/advertising; automazione/gestione/operations; dati/misurazione).

## 7.1 Gap di posizionamento e messaggio → leva strategica
*Sintomo:* A alto ma il messaggio è confuso/generico/assente; value proposition non leggibile; narrativa forte ma non raccontata; sito che non comunica la differenziazione reale. *Natura del gap:* l'azienda **non sa dire** ciò che è. *Leva:* riposizionamento, chiarificazione del messaggio, articolazione della narrativa e della differenziazione. È il gap più "a monte": spesso prerequisito di tutti gli altri.

## 7.2 Gap di acquisizione ed espressione → leva contenuti/advertising
*Sintomo:* prodotto forte e (talvolta) messaggio chiaro, ma **nessuna macchina di acquisizione**: niente advertising (assenza nelle librerie pubbliche), contenuti scarsi o assenti, social abbandonati, nessuna generazione di domanda. *Natura del gap:* l'azienda **non si fa trovare e non genera domanda**. *Leva:* content engine e campagne di acquisizione performance. È il gap dove il potenziale inespresso si traduce più direttamente in vendite mancate.

## 7.3 Gap di presidio e conversione → leva automazione/operations
*Sintomo:* arriva interesse (recensioni, passaparola, richieste) ma **non è presidiato**: recensioni mai gestite, richieste/DM senza follow-up, nessun CRM, percorso di conversione rotto. *Natura del gap:* l'azienda **non cattura né converte** la domanda che già esiste. *Leva:* automazione del follow-up, gestione lead, ordinamento del percorso di conversione.

## 7.4 Gap di misurazione e visibilità del dato → leva dati/dashboard
*Sintomo:* attività esistente ma **cieca**: nessun tracciamento, nessuna lettura di cosa funziona, decisioni a sensazione. *Natura del gap:* l'azienda **non sa cosa sta funzionando**. *Leva:* misurazione, lettura dei dati, dashboard. Spesso emerge come gap secondario una volta avviati gli altri.

## 7.5 Lettura combinata
La maggior parte dei target presenta **più gap insieme**, in sequenza logica: prima non sa dirsi (7.1), poi non si fa trovare (7.2), poi non cattura ciò che arriva (7.3), poi non misura (7.4). Per ogni azienda l'AI può quindi annotare **quali leve sarebbero attivabili e in quale ordine**, arricchendo la qualificazione del target con la dimensione "tipo di intervento richiesto" — senza, in questa fase, alcuna quantificazione.

---

# APPENDICE A — GLOSSARIO DI FRAMEWORK E AUTORI DI RIFERIMENTO

- **April Dunford, "Obviously Awesome"** — 5(+1) componenti del posizionamento: competitive alternatives, unique attributes, value (and proof), target market characteristics, market category, (+) relevant trends. La "proof" può/deve poggiare su validazione di terzi.
- **Al Ries & Jack Trout, "Positioning: The Battle for Your Mind" (1981)** — posizione nella mente del prospect; essere primi > essere migliori; creneau; ladder; coerenza e ripetizione; "the essence of positioning is sacrifice".
- **Kevin Lane Keller** — Points of Difference (POD, unici e forti) vs Points of Parity (POP, mandatori di categoria); brand mantra; Customer-Based Brand Equity; (con Sternthal & Tybout, 2002) avvertenze sui POD copiabili.
- **Philip Kotler** — variabili di differenziazione (forma, feature, qualità di performance/conformità, durata, affidabilità, riparabilità, stile, design, personalizzazione; servizio; personale; canale; immagine); cinque livelli di prodotto (core/generic/expected/augmented/potential).
- **Play Bigger (Ramadan, Peterson, Lochhead, Maney), "Category Design"** — category king; "different > better"; il category king cattura ~76% del valore (market cap) della categoria.
- **Geoffrey Moore, "Crossing the Chasm"** — technology adoption lifecycle (innovators → early adopters → early majority → late majority → laggards); il "chasm"; strategia del "beachhead" / dominio di nicchia prima dell'espansione.
- **Michael Porter** — strategie generiche (cost leadership, differentiation, focus, con cost focus e differentiation focus); rischio dello "stuck in the middle"; vantaggio competitivo come posizione difendibile.
- **Jay Barney, VRIO/VRIN (1991/1995)** — Valuable, Rare, costly to Imitate, Organized; resource-based view; complementare a Porter (interno vs esterno).
- **Morningstar (economic moat, dal concetto di W. Buffett)** — cinque fonti: intangible assets, switching costs, network effect, cost advantage, efficient scale; wide moat (>20 anni) vs narrow moat (~10 anni); "marchio noto o lunga storia ≠ moat automatico".
- **David Aaker, "Managing Brand Equity"** — brand loyalty, brand awareness, perceived quality, brand associations, other proprietary assets.
- **Simon Sinek, Golden Circle ("Start With Why")** — Why → How → What; cervello limbico vs neocorteccia; "people buy WHY you do it" (con caveat sulla base aneddotica).
- **Mark & Pearson, "The Hero and the Outlaw"** — 12 archetipi di brand su base junghiana (Innocente, Esploratore, Saggio, Eroe, Outlaw, Mago, Uomo Comune, Amante, Giullare, Caregiver, Creatore, Sovrano); regola pratica 70/30.
- **Donald Miller, StoryBrand (SB7)** — cliente eroe, brand guida; grunt test / regola dei pochi secondi; "a confused visitor will never become a customer"; chiarezza > creatività.
- **Country of Origin Effect / Made in Italy** — valore differenziale del territorio; heritage brand vs nostalgic marketing; Registro speciale dei marchi storici di interesse nazionale (2019); strategie corporate heritage (authenticity/leadership/continuity).
- **Meta Ad Library / Google Ads Transparency Center** — librerie pubbliche degli annunci: rendono osservabili presenza, formati, varianti e frequenza di refresh delle campagne.
- **Vanity metrics vs actionable metrics** — follower/like/impression/pageview sono gonfiabili e fuorvianti senza contesto di engagement/conversione; criterio di smascheramento: "questa metrica può guidare una decisione?".

---

# APPENDICE B — TASSONOMIA SINTETICA DELLE FONTI PER ASSE (riferimento rapido per il sistema)

**Per misurare A (privilegiare sempre):**
- Registri pubblici/camerali → anzianità, capitale, dipendenti, bilanci, oggetto sociale.
- Banche dati brevetti/marchi → asset proprietari, moat (intangible assets).
- Registro marchi storici (IT, 2019) → heritage verificato.
- Albi premi, enti certificatori → riconoscimenti, qualità reale.
- Cataloghi/directory di settore, schede distributori → differenziazione descritta da terzi, prezzo/posizionamento.
- Stampa specializzata, voci enciclopediche, citazioni di esperti → narrativa, reputazione, prova sociale.
- Cataloghi espositori fiere → serietà, presenza di settore.
- Recensioni clienti (contenuto/valutazione) → qualità percepita.
- Dati export/filiere → validazione e trazione.

**Per misurare B:**
- Sito web (messaggio, UX, prove, CTA, multilingua, freschezza, velocità).
- SEO (trovabilità su keyword di categoria vs solo brand).
- Google Business Profile / local (completezza, foto, gestione recensioni).
- Recensioni (gestione/risposte/recency).
- Social: Instagram, TikTok, YouTube, LinkedIn (presenza, coerenza, qualità, engagement reale, thought leadership).
- Marketplace ed e-commerce proprietario (schede, esperienza d'acquisto).
- Librerie annunci (presenza/assenza/sofisticazione advertising).
- Email/owned audience (newsletter, lead magnet, nurturing).
- PR digitale (capacità di generare e valorizzare copertura).
- Eco digitale delle fiere.
- Coerenza cross-canale.

**Fonti ibride (scomporre tra A e B):** recensioni, PR/stampa, fiere.

---

# CAVEAT (limiti e avvertenze d'uso del documento)

1. **Documento puramente concettuale.** Non contiene strumenti né scoring; l'assenza di pesi numerici è deliberata e va rispettata fino alle iterazioni dedicate. Qualsiasi quantificazione introdotta a valle dovrà preservare la separazione dei due assi e la centralità del divario A−B.
2. **Il nesso "fiera → credibilità" è un'euristica robusta ma non ancorata** in questa fase a una singola fonte accademica nominata: trattarlo come ipotesi forte di settore (B2B/manifatturiero/Made in Italy), da validare con fonti dedicate nelle iterazioni successive.
3. **Il Golden Circle di Sinek è un modello influente ma criticato** per la base prevalentemente aneddotica: usarlo come lente per *riconoscere* la presenza/assenza di uno scopo articolato, non come legge predittiva.
4. **Le ponderazioni B2B/B2C/B2B2C sono priori da aggiornare con l'evidenza, non regole rigide.** Il dato sull'engagement B2B più alto su Instagram che su LinkedIn impone cautela: l'efficacia di canale spesso trascende le assunzioni tradizionali.
5. **Le statistiche puntuali su recensioni, SEO local e category design** (es. ~76% di market cap del category king) provengono da ricerche di settore e divulgative: vanno trattate come **ordini di grandezza** orientativi, non come costanti universali, e riverificate se usate in produzione. Il documento non dipende da quei numeri per reggere.
6. **Asimmetria fondante da non dimenticare mai:** per il target ideale, A è alto *proprio mentre* B è basso. Ogni scorciatoia che deduce A da B riproduce l'errore che il sistema deve evitare. La disciplina della doppia fonte (terzi per A, owned per B) è la garanzia metodologica dell'intero impianto.
7. **Gli archetipi (Parte VI) e il mapping gap→leva (Parte VII) sono illustrativi e concettuali.** Gli archetipi sono attrattori per il riconoscimento di pattern, non categorie rigide; il mapping traduce la diagnosi in *tipo* di intervento, senza procedure, strumenti o quantificazioni.
8. **La declinazione dell'Asse A per modello/settore (§2.8) e i tre principi trasversali (§1.4 relatività di categoria, §1.5 traiettoria, §4.4–4.5 causa e disqualificatori) sono parte integrante del giudizio.** Saltarli riporta il sistema agli errori del singolo asse: valutare in assoluto, ignorare la direzione, scambiare un gap incolmabile per un'opportunità.
