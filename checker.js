const { chromium } = require('playwright');

async function searchName(page, name, isFirstSearch) {
  // Solo alla prima ricerca: vai alla homepage e accetta cookies
  if (isFirstSearch) {
    await page.goto('https://lexascan.com/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // Accetta i cookies se presente il banner
    try {
      const acceptButton = page.locator('button:has-text("ACCEPT ALL"), button:has-text("Accept All"), button:has-text("Accept")').first();
      if (await acceptButton.count() > 0 && await acceptButton.isVisible()) {
        console.log('Accettando cookies...');
        await acceptButton.click();
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      console.log('Nessun banner cookies trovato o già accettato');
    }
  }

  // Cerca il campo di input
  const searchInput = page.locator('input[type="text"]').first();

  if (await searchInput.count() === 0) {
    throw new Error('Campo di ricerca non trovato');
  }

  // Clicca, pulisce e inserisce il nome
  await searchInput.click();
  await page.waitForTimeout(300);
  await searchInput.fill('');
  await searchInput.fill(name);
  await page.waitForTimeout(300);

  console.log(`Nome inserito: ${name}`);

  // Clicca il tasto CHECK
  const checkButton = page.locator('button:has-text("CHECK")').first();
  if (await checkButton.count() > 0) {
    console.log('Cliccando CHECK...');
    await checkButton.click();
  } else {
    console.log('Tasto CHECK non trovato, provo Enter');
    await searchInput.press('Enter');
  }

  // Attende i risultati
  await page.waitForTimeout(4000);

  // Legge il testo della pagina
  const bodyText = await page.locator('body').innerText();
  const lowerText = bodyText.toLowerCase();

  console.log('--- Testo pagina (primi 800 char) ---');
  console.log(bodyText.substring(0, 800));
  console.log('--- Fine ---');

  // Risultato da restituire
  const result = {
    hasMatch: false,
    details: []
  };

  // Controlla se c'è "no matches found"
  if (lowerText.includes('no matches found')) {
    console.log('Rilevato: No matches found');
    return result;
  }

  // Cerca la tabella dei risultati - estrai le righe
  // Il formato tipico è: NOME | TIPO | LISTA | PROGRAMMA | SIMILARITA | AZIONI
  try {
    // Cerca righe nella tabella dei risultati
    const tableRows = page.locator('table tbody tr, .results-table tr, .search-results tr');
    const rowCount = await tableRows.count();

    console.log(`Righe tabella trovate: ${rowCount}`);

    if (rowCount > 0) {
      for (let i = 0; i < Math.min(rowCount, 10); i++) {
        const rowText = await tableRows.nth(i).innerText();

        // Salta righe vuote o "no matches"
        if (rowText.toLowerCase().includes('no matches') || rowText.trim() === '') {
          continue;
        }

        // Estrai informazioni dalla riga
        // Cerca pattern di liste sanzioni: OFAC, UN, EU, HMT
        const sanctionLists = [];
        if (rowText.includes('OFAC') || rowText.toLowerCase().includes('ofac')) sanctionLists.push('OFAC (USA)');
        if (rowText.includes('UN') || rowText.toLowerCase().includes('united nations')) sanctionLists.push('UN');
        if (rowText.includes('EU') || rowText.toLowerCase().includes('european')) sanctionLists.push('EU');
        if (rowText.includes('HMT') || rowText.toLowerCase().includes('hmt')) sanctionLists.push('HMT (UK)');

        if (sanctionLists.length > 0 || !rowText.toLowerCase().includes('no match')) {
          result.hasMatch = true;
          result.details.push({
            rawText: rowText.substring(0, 200),
            sanctionLists: sanctionLists
          });
        }
      }
    }
  } catch (e) {
    console.log('Errore lettura tabella:', e.message);
  }

  // Se non abbiamo trovato match dalla tabella, controlla il testo generale
  if (!result.hasMatch) {
    // Cerca indicatori di match nel testo
    const matchPatterns = [
      /(\d+)\s*match(?:es)?\s*found/i,
      /found\s*(\d+)\s*match/i,
      /(\d+)\s*result/i
    ];

    for (const pattern of matchPatterns) {
      const match = bodyText.match(pattern);
      if (match && parseInt(match[1]) > 0) {
        result.hasMatch = true;

        // Cerca liste nel testo
        const lists = [];
        if (bodyText.includes('OFAC')) lists.push('OFAC (USA)');
        if (bodyText.includes('United Nations') || bodyText.includes(' UN ')) lists.push('UN');
        if (bodyText.includes('European Union') || bodyText.includes(' EU ')) lists.push('EU');
        if (bodyText.includes('HMT')) lists.push('HMT (UK)');

        result.details.push({
          matchCount: parseInt(match[1]),
          sanctionLists: lists
        });
        break;
      }
    }
  }

  console.log(`Risultato ricerca: ${result.hasMatch ? 'MATCH' : 'Nessun match'}`);
  if (result.details.length > 0) {
    console.log('Dettagli:', JSON.stringify(result.details));
  }

  return result;
}

async function checkSanctions(company, beneficialOwner) {
  const isProduction = process.env.NODE_ENV === 'production';
  const browser = await chromium.launch({
    headless: isProduction, // headless in prod, visibile in dev
    slowMo: isProduction ? 100 : 300
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  let companyResult = { hasMatch: false, details: [] };
  let ownerResult = { hasMatch: false, details: [] };

  try {
    console.log(`\n=== Controllo azienda: ${company} ===`);
    companyResult = await searchName(page, company, true);
    console.log(`Risultato azienda: ${companyResult.hasMatch ? 'MATCH TROVATO' : 'Nessun match'}`);

    await page.waitForTimeout(1000);

    console.log(`\n=== Controllo beneficial owner: ${beneficialOwner} ===`);
    ownerResult = await searchName(page, beneficialOwner, false);
    console.log(`Risultato owner: ${ownerResult.hasMatch ? 'MATCH TROVATO' : 'Nessun match'}`);

  } catch (error) {
    console.error('Errore durante la ricerca:', error);
    throw error;
  } finally {
    await browser.close();
  }

  return {
    companyMatch: companyResult.hasMatch,
    companyDetails: companyResult.details,
    ownerMatch: ownerResult.hasMatch,
    ownerDetails: ownerResult.details
  };
}

module.exports = { checkSanctions };
