let ALL_CATEGORIES = [];

document.addEventListener('DOMContentLoaded', async () => {
    // Load Categories for Autocomplete
    try {
        const res = await fetch('categories.json');
        ALL_CATEGORIES = await res.json();
    } catch (e) {
        console.error('Failed to load categories', e);
    }

    const nicheInput = document.getElementById('niche');
    const provinceInput = document.getElementById('province');

    // Setup Autocomplete on Niche input
    setupAutocomplete(nicheInput);

    // Smart Inputs Listeners
    [nicheInput, provinceInput].forEach(input => {
        input.addEventListener('input', updateStrategyPreview);
    });

    // Update Status Mock
    setInterval(() => {
        const load = Math.floor(Math.random() * 30) + 10;
        document.getElementById('queueLoad').textContent = `${load}%`;
    }, 3000);

    // Check initial health
    checkHealth();
});

function setupAutocomplete(input) {
    const wrapper = document.createElement('div');
    wrapper.className = 'autocomplete-container';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const list = document.createElement('div');
    list.className = 'autocomplete-results';
    wrapper.appendChild(list);

    input.addEventListener('input', function (e) {
        const val = this.value;
        const currentTerm = val.split(',').pop().trim();

        list.innerHTML = '';
        if (!currentTerm) {
            list.style.display = 'none';
            return;
        }

        const matches = ALL_CATEGORIES.filter(c =>
            c.toLowerCase().includes(currentTerm.toLowerCase())
        ).slice(0, 10);

        if (matches.length > 0) {
            list.style.display = 'block';
            matches.forEach(match => {
                const nav = document.createElement('div');
                nav.className = 'autocomplete-item';
                const regex = new RegExp(`(${currentTerm})`, 'gi');
                nav.innerHTML = match.replace(regex, '<strong>$1</strong>');

                nav.addEventListener('click', () => {
                    const terms = val.split(',');
                    terms.pop();
                    terms.push(match);
                    input.value = terms.join(', ') + ', ';
                    list.style.display = 'none';
                    updateStrategyPreview();
                    input.focus();
                });
                list.appendChild(nav);
            });
        } else {
            list.style.display = 'none';
        }
    });

    document.addEventListener('click', function (e) {
        if (e.target !== input) {
            list.style.display = 'none';
        }
    });
}

function buildSmartQueries(nicheInput, provinceInput) {
    if (!nicheInput || !provinceInput) return [];

    const niches = nicheInput.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const provinces = provinceInput.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const queries = [];

    niches.forEach(niche => {
        provinces.forEach(province => {
            queries.push(`${niche} ${province}`);
            queries.push(`${niche} in ${province}`);
            queries.push(`${niche} vicino a ${province}`);
            queries.push(`Aziende ${niche} ${province}`);
        });
    });

    return queries;
}

function updateStrategyPreview() {
    const niche = document.getElementById('niche').value;
    const province = document.getElementById('province').value;
    const container = document.getElementById('queryPreviewContainer');
    const tagsContainer = document.getElementById('queryTags');

    const queries = buildSmartQueries(niche, province);
    tagsContainer.innerHTML = '';

    if (queries.length > 0) {
        container.style.display = 'block';
        queries.forEach(q => {
            const tag = document.createElement('span');
            tag.className = 'query-tag';
            tag.textContent = q;
            tagsContainer.appendChild(tag);
        });
    } else {
        container.style.display = 'none';
    }
}

async function checkHealth() {
    try {
        const res = await fetch('/health');
        const data = await res.json();
        if (data.status === 'ok') {
            document.querySelector('.dot').style.backgroundColor = '#00ff88';
            document.querySelector('.dot').style.boxShadow = '0 0 10px #00ff88';
            document.getElementById('nodeCount').textContent = '1 (Active)';
        }
    } catch (e) {
        console.warn('Health check failed', e);
        document.querySelector('.dot').style.backgroundColor = '#ff0055';
        document.querySelector('.dot').style.boxShadow = '0 0 10px #ff0055';
    }
}

document.getElementById('launchBtn').addEventListener('click', async () => {
    const niche = document.getElementById('niche').value.trim();
    const province = document.getElementById('province').value.trim();

    if (!niche) {
        alert('⛔ NICHE/KEYWORD REQUIRED');
        return;
    }

    if (!province) {
        alert('⛔ PROVINCE REQUIRED');
        return;
    }

    const btnText = document.querySelector('.btn-text');
    const originalText = btnText.textContent;

    try {
        btnText.textContent = 'LAUNCHING...';
        document.getElementById('launchBtn').style.opacity = '0.7';

        const expandedQueries = buildSmartQueries(niche, province);

        const payload = {
            target: {
                niche_raw: niche,
                location_raw: province,
                expanded_queries: expandedQueries,
                strategy: 'smart_expansion'
            }
        };

        const response = await fetch('/api/start-job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.success) {
            alert(`✅ SCRAPER LAUNCHED!\n\nJob ID: ${result.jobId}\nTarget: ${niche} → ${province}\n\nCheck output/campaigns/ for results.`);
        } else {
            alert(`❌ ERROR: ${result.message}`);
        }

    } catch (error) {
        alert(`❌ NETWORK FAILURE: ${error.message}`);
    } finally {
        btnText.textContent = originalText;
        document.getElementById('launchBtn').style.opacity = '1';
    }
});
