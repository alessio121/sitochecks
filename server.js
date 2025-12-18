const express = require('express');
const fs = require('fs');
const path = require('path');
const { checkSanctions } = require('./checker');

const app = express();
const PORT = 3000;
const DATA_DIR = process.env.NODE_ENV === 'production' ? '/app/data' : __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

app.use(express.json());
app.use(express.static('public'));

// Inizializza file dati se non esiste
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([]));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// GET - Lista tutti i record
app.get('/api/records', (req, res) => {
  const data = loadData();
  res.json(data);
});

// POST - Aggiunge nuovo record
app.post('/api/records', (req, res) => {
  const { company, beneficialOwner } = req.body;

  if (!company) {
    return res.status(400).json({ error: 'Il nome azienda è richiesto' });
  }

  const data = loadData();
  const newRecord = {
    id: Date.now().toString(),
    company,
    beneficialOwner: beneficialOwner || '',
    status: 'unchecked', // unchecked, clear, alert
    companyMatch: null,
    ownerMatch: null,
    lastChecked: null
  };

  data.push(newRecord);
  saveData(data);
  res.status(201).json(newRecord);
});

// PUT - Modifica record
app.put('/api/records/:id', (req, res) => {
  const { id } = req.params;
  const { company, beneficialOwner } = req.body;

  if (!company) {
    return res.status(400).json({ error: 'Il nome azienda è richiesto' });
  }

  let data = loadData();
  const record = data.find(r => r.id === id);

  if (!record) {
    return res.status(404).json({ error: 'Record non trovato' });
  }

  record.company = company;
  record.beneficialOwner = beneficialOwner || '';
  // Reset status se i dati sono cambiati
  record.status = 'unchecked';
  record.companyMatch = null;
  record.ownerMatch = null;
  record.companyDetails = [];
  record.ownerDetails = [];
  record.lastChecked = null;

  saveData(data);
  res.json(record);
});

// DELETE - Elimina record
app.delete('/api/records/:id', (req, res) => {
  const { id } = req.params;
  let data = loadData();
  const index = data.findIndex(r => r.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Record non trovato' });
  }

  data.splice(index, 1);
  saveData(data);
  res.json({ success: true });
});

// POST - Esegue controllo su lexascan.com
app.post('/api/check/:id', async (req, res) => {
  const { id } = req.params;
  let data = loadData();
  const record = data.find(r => r.id === id);

  if (!record) {
    return res.status(404).json({ error: 'Record non trovato' });
  }

  try {
    // Esegue il controllo con Playwright
    const result = await checkSanctions(record.company, record.beneficialOwner);

    // Aggiorna il record
    record.companyMatch = result.companyMatch;
    record.companyDetails = result.companyDetails || [];
    record.ownerMatch = result.ownerMatch;
    record.ownerDetails = result.ownerDetails || [];
    record.status = (result.companyMatch || result.ownerMatch) ? 'alert' : 'clear';
    record.lastChecked = new Date().toISOString();

    saveData(data);
    res.json(record);
  } catch (error) {
    console.error('Errore durante il check:', error);
    res.status(500).json({ error: 'Errore durante il controllo: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server in esecuzione su http://localhost:${PORT}`);
});
