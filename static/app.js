// State management
let appState = {
    patients: [],
    currentSeries: null,
    currentSlices: [],
    currentIndex: 0,
    activeTool: 'zoom', // 'scroll', 'window', 'zoom'
    
    // Windowing state
    windowCenter: 40,
    windowWidth: 400,
    originalCenter: 40,
    originalWidth: 400,
    
    // Cine loop playback
    isPlaying: false,
    cineInterval: null,
    fps: 5,
    
    // Zoom & Pan state
    zoom: 1,
    panX: 0,
    panY: 0,
    isDragging: false,
    startX: 0,
    startY: 0,
    
    // Metadata tags
    currentTags: [],
    
    // Demo Generation State
    isGeneratingDemo: false,
    
    // Background slice preloading queue
    preloadQueue: [],
    isPreloading: false,
    
    // AI diagnostics state
    showAiHighlight: true,
    aiResults: null,
    isAiAnalyzing: false
};

// UI Elements
const els = {
    dirPathInput: document.getElementById('directory-path'),
    scanBtn: document.getElementById('scan-btn'),
    demoBtn: document.getElementById('demo-btn'),
    statusText: document.getElementById('status-text'),
    patientCount: document.getElementById('patient-count'),
    patientSearch: document.getElementById('patient-search'),
    navigatorTree: document.getElementById('navigator-tree'),
    
    // Toolbar & Controls
    toolScroll: document.getElementById('tool-scroll'),
    toolWindow: document.getElementById('tool-window'),
    toolZoom: document.getElementById('tool-zoom'),
    windowPreset: document.getElementById('window-preset'),
    
    // Cine
    cinePrev: document.getElementById('cine-prev'),
    cinePlay: document.getElementById('cine-play'),
    cineNext: document.getElementById('cine-next'),
    cineFps: document.getElementById('cine-fps'),
    fpsValue: document.getElementById('fps-value'),
    playIcon: document.getElementById('play-icon'),
    pauseIcon: document.getElementById('pause-icon'),
    
    resetBtn: document.getElementById('reset-btn'),
    
    // Viewport
    viewportContainer: document.getElementById('dicom-viewport-container'),
    imageWrapper: document.getElementById('image-wrapper'),
    dicomImg: document.getElementById('dicom-img'),
    viewportLoader: document.getElementById('viewport-loader'),
    viewportPlaceholder: document.getElementById('viewport-placeholder'),
    
    // Corner Overlays
    patientNameOverlay: document.querySelector('#overlay-patient .patient-name'),
    patientIdOverlay: document.querySelector('#overlay-patient .patient-id'),
    patientBirthOverlay: document.querySelector('#overlay-patient .patient-birth'),
    
    studyDateOverlay: document.querySelector('#overlay-study .study-date'),
    studyDescOverlay: document.querySelector('#overlay-study .study-desc'),
    modalityOverlay: document.querySelector('#overlay-study .modality-badge'),
    
    sliceIndexOverlay: document.querySelector('#overlay-stats .slice-index'),
    sliceLocOverlay: document.querySelector('#overlay-stats .slice-loc'),
    zoomOverlay: document.querySelector('#overlay-stats .zoom-level'),
    
    wcOverlay: document.querySelector('#overlay-window .window-c'),
    wwOverlay: document.querySelector('#overlay-window .window-w'),
    
    // Quick Sliders
    wcSlider: document.getElementById('wc-slider'),
    wwSlider: document.getElementById('ww-slider'),
    wcValue: document.getElementById('wc-value'),
    wwValue: document.getElementById('ww-value'),
    
    // Scrubber
    sliceRange: document.getElementById('slice-range'),
    scrubberPrevBtn: document.getElementById('scrubber-prev-btn'),
    scrubberNextBtn: document.getElementById('scrubber-next-btn'),
    
    // Tag inspector
    tagCount: document.getElementById('tag-count'),
    tagSearch: document.getElementById('tag-search'),
    tagsTbody: document.getElementById('tags-tbody'),
    
    // Help Modal
    helpModal: document.getElementById('help-modal'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    
    // AI Elements
    aiAnalyzeBtn: document.getElementById('ai-analyze-btn'),
    aiResultsPanel: document.getElementById('ai-results-panel'),
    closeAiBtn: document.getElementById('close-ai-btn'),
    aiStatusVal: document.getElementById('ai-status-val'),
    aiFindingsText: document.getElementById('ai-findings-text'),
    aiRecText: document.getElementById('ai-rec-text'),
    aiToggleOverlay: document.getElementById('ai-toggle-overlay'),
    aiFindingBanner: document.getElementById('ai-finding-banner'),
    aiFindingBannerText: document.getElementById('ai-finding-banner-text'),
    aiFindingsListBox: document.getElementById('ai-findings-list-box'),
    aiFindingsList: document.getElementById('ai-findings-list'),
    aiListTitle: document.getElementById('ai-list-title'),
    scrubberMarkers: document.getElementById('scrubber-markers'),
    sliceAiStatus: document.getElementById('slice-ai-status'),
    
    // Sidebar Toggles
    toggleTagsBtn: document.getElementById('toggle-tags-btn'),
    closeTagsSidebarBtn: document.getElementById('close-tags-sidebar-btn')
};

// Presets Definition (Center / Width)
const PRESETS = {
    default: null, // Read from DICOM header
    soft: { wc: 40, ww: 400 },
    bone: { wc: 500, ww: 2000 },
    lung: { wc: -600, ww: 1600 },
    brain: { wc: 40, ww: 80 }
};

// Initial Setup
window.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    resetViewportUI();
    
    // Attempt auto-scan of default folder if exists
    scanFolder(false);
});

// Event Listeners Registration
function setupEventListeners() {
    // Scan directory
    els.scanBtn.addEventListener('click', () => scanFolder(true));
    els.dirPathInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') scanFolder(true);
    });
    
    // Demo generator
    els.demoBtn.addEventListener('click', generateDemoData);

    // Sidebar search
    els.patientSearch.addEventListener('input', filterNavigatorTree);
    
    // Tool Selection
    els.toolScroll.addEventListener('click', () => setActiveTool('scroll'));
    els.toolWindow.addEventListener('click', () => setActiveTool('window'));
    els.toolZoom.addEventListener('click', () => setActiveTool('zoom'));
    
    // Presets
    els.windowPreset.addEventListener('change', handlePresetChange);
    
    // Cine loop controls
    els.cinePrev.addEventListener('click', prevSlice);
    els.cineNext.addEventListener('click', nextSlice);
    els.cinePlay.addEventListener('click', toggleCinePlay);
    els.cineFps.addEventListener('input', (e) => {
        appState.fps = parseInt(e.target.value);
        els.fpsValue.textContent = appState.fps;
        if (appState.isPlaying) {
            stopCinePlay();
            startCinePlay();
        }
    });
    
    // Reset view
    els.resetBtn.addEventListener('click', resetViewportTransform);
    
    // Scrubber
    els.sliceRange.addEventListener('input', (e) => {
        if (appState.currentSlices.length > 0) {
            appState.currentIndex = parseInt(e.target.value);
            loadSlice(appState.currentIndex);
        }
    });
    els.scrubberPrevBtn.addEventListener('click', prevSlice);
    els.scrubberNextBtn.addEventListener('click', nextSlice);
    
    // Interactive Viewport dragging / panning / windowing
    els.imageWrapper.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    els.imageWrapper.addEventListener('wheel', handleMouseWheel, { passive: false });
    
    // Double click resets zoom/pan
    els.imageWrapper.addEventListener('dblclick', resetViewportTransform);
    
    // Metadata searching
    els.tagSearch.addEventListener('input', filterMetadataTags);
    
    // Keyboard shortcuts
    window.addEventListener('keydown', handleKeyDown);
    
    // Help Modal
    els.closeModalBtn.addEventListener('click', toggleHelpModal);
    els.helpModal.addEventListener('click', (e) => {
        if (e.target === els.helpModal) toggleHelpModal();
    });
    
    // AI Listeners
    els.aiAnalyzeBtn.addEventListener('click', runAiAnalysis);
    els.closeAiBtn.addEventListener('click', closeAiPanel);
    els.aiToggleOverlay.addEventListener('change', (e) => {
        appState.showAiHighlight = e.target.checked;
        updateSliceImage();
    });
    
    // Toggle tags listener
    els.toggleTagsBtn.addEventListener('click', toggleTagsSidebar);
    els.closeTagsSidebarBtn.addEventListener('click', toggleTagsSidebar);
    
    // Manual Sliders (GPU Contrast/Brightness CSS filters visual feedback during dragging)
    els.wcSlider.addEventListener('input', (e) => {
        appState.windowCenter = parseInt(e.target.value);
        els.wcValue.textContent = appState.windowCenter;
        els.wcOverlay.textContent = `WC: ${appState.windowCenter}`;
        
        let contrastFactor = appState.originalWidth / appState.windowWidth;
        let brightnessFactor = 1.0 - (appState.windowCenter - appState.originalCenter) / appState.originalWidth;
        els.dicomImg.style.filter = `brightness(${Math.max(0.2, brightnessFactor)}) contrast(${Math.max(0.2, contrastFactor)})`;
    });
    els.wcSlider.addEventListener('change', () => {
        els.dicomImg.style.filter = 'none';
        updateSliceImage();
        startPreloading();
    });
    
    els.wwSlider.addEventListener('input', (e) => {
        appState.windowWidth = parseInt(e.target.value);
        els.wwValue.textContent = appState.windowWidth;
        els.wwOverlay.textContent = `WW: ${appState.windowWidth}`;
        
        let contrastFactor = appState.originalWidth / appState.windowWidth;
        let brightnessFactor = 1.0 - (appState.windowCenter - appState.originalCenter) / appState.originalWidth;
        els.dicomImg.style.filter = `brightness(${Math.max(0.2, brightnessFactor)}) contrast(${Math.max(0.2, contrastFactor)})`;
    });
    els.wwSlider.addEventListener('change', () => {
        els.dicomImg.style.filter = 'none';
        updateSliceImage();
        startPreloading();
    });
}

// Set Active Tool
function setActiveTool(tool) {
    appState.activeTool = tool;
    els.toolScroll.classList.toggle('active', tool === 'scroll');
    els.toolWindow.classList.toggle('active', tool === 'window');
    els.toolZoom.classList.toggle('active', tool === 'zoom');
}

// Generate Demo Data
function generateDemoData() {
    if (appState.isGeneratingDemo) return;
    
    appState.isGeneratingDemo = true;
    els.demoBtn.disabled = true;
    els.demoBtn.textContent = 'Generating...';
    els.statusText.textContent = 'Generating 3D Head Phantom scans...';
    
    fetch('/api/generate-demo', {
        method: 'POST'
    })
    .then(res => res.json())
    .then(data => {
        appState.isGeneratingDemo = false;
        els.demoBtn.disabled = false;
        els.demoBtn.textContent = 'Generate Demo';
        
        if (data.success) {
            els.dirPathInput.value = 'demo_scans';
            scanFolder(true);
        } else {
            alert('Failed to generate demo data: ' + data.error);
            els.statusText.textContent = 'Generation failed';
        }
    })
    .catch(err => {
        appState.isGeneratingDemo = false;
        els.demoBtn.disabled = false;
        els.demoBtn.textContent = 'Generate Demo';
        alert('Server connection error during demo generation: ' + err.message);
        els.statusText.textContent = 'Server error';
    });
}

// Scan Folder
function scanFolder(showFeedback = true) {
    const path = els.dirPathInput.value.trim();
    if (!path) {
        if (showFeedback) alert('Please enter a directory path.');
        return;
    }
    
    els.statusText.textContent = 'Scanning directory...';
    els.scanBtn.disabled = true;
    els.scanBtn.textContent = 'Scanning...';
    
    fetch('/api/scan', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: path })
    })
    .then(res => res.json())
    .then(data => {
        els.scanBtn.disabled = false;
        els.scanBtn.textContent = 'Scan Folder';
        
        if (data.error) {
            els.statusText.textContent = 'Scan failed';
            if (showFeedback) alert('Scan Error: ' + data.error);
            return;
        }
        
        appState.patients = data.patients || [];
        els.patientCount.textContent = `${appState.patients.length} Patients`;
        els.statusText.textContent = `Scan complete. Found ${data.total_files} slices.`;
        
        buildNavigatorTree();
    })
    .catch(err => {
        els.scanBtn.disabled = false;
        els.scanBtn.textContent = 'Scan Folder';
        els.statusText.textContent = 'Connection error';
        if (showFeedback) alert('Failed to connect to the server: ' + err.message);
    });
}

// Build Study Navigator Tree in Sidebar
function buildNavigatorTree() {
    els.navigatorTree.innerHTML = '';
    
    if (appState.patients.length === 0) {
        els.navigatorTree.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                <p>No valid DICOM files found in this folder.</p>
                <p class="sub-text">Check the folder path or try another directory.</p>
            </div>
        `;
        return;
    }
    
    appState.patients.forEach((patient, pIdx) => {
        const pNode = document.createElement('div');
        pNode.className = 'patient-node';
        
        // Calculate total series/slices for subtitles
        let studyCount = patient.studies.length;
        let seriesCount = 0;
        patient.studies.forEach(s => seriesCount += s.series.length);
        
        pNode.innerHTML = `
            <div class="patient-header" data-id="${patient.id}">
                <div class="patient-info">
                    <span class="patient-title">${patient.name}</span>
                    <span class="patient-subtitle">ID: ${patient.id} • ${seriesCount} Series</span>
                </div>
                <svg class="arrow-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </div>
            <div class="studies-list"></div>
        `;
        
        const studiesList = pNode.querySelector('.studies-list');
        
        patient.studies.forEach(study => {
            const sNode = document.createElement('div');
            sNode.className = 'study-node';
            
            // Format DICOM date safely: YYYYMMDD -> YYYY-MM-DD
            let dateStr = study.date;
            if (dateStr && dateStr.length === 8) {
                dateStr = `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}`;
            } else {
                dateStr = 'Unknown Date';
            }
            
            sNode.innerHTML = `
                <div class="study-header">
                    <span class="study-title">${study.description}</span>
                    <span class="study-date-label">${dateStr}</span>
                </div>
                <div class="series-list"></div>
            `;
            
            const seriesList = sNode.querySelector('.series-list');
            
            study.series.forEach(series => {
                const seNode = document.createElement('div');
                seNode.className = 'series-item';
                seNode.dataset.seriesUid = series.uid;
                seNode.dataset.patientId = patient.id;
                seNode.dataset.studyUid = study.uid;
                
                seNode.innerHTML = `
                    <span>Series ${series.number}: ${series.description}</span>
                    <div class="series-meta">
                        <span class="modality-tag">${series.modality}</span>
                        <span class="badge">${series.slice_count}</span>
                    </div>
                `;
                
                seNode.addEventListener('click', () => {
                    document.querySelectorAll('.series-item').forEach(item => item.classList.remove('active'));
                    seNode.classList.add('active');
                    loadSeries(patient, study, series);
                });
                
                seriesList.appendChild(seNode);
            });
            
            studiesList.appendChild(sNode);
        });
        
        // Expand/Collapse Patient Node
        const pHeader = pNode.querySelector('.patient-header');
        pHeader.addEventListener('click', () => {
            pNode.classList.toggle('expanded');
        });
        
        // Automatically expand first patient
        if (pIdx === 0) {
            pNode.classList.add('expanded');
        }
        
        els.navigatorTree.appendChild(pNode);
    });
}

// Filter Sidebar Tree
function filterNavigatorTree() {
    const query = els.patientSearch.value.toLowerCase().trim();
    const patientNodes = document.querySelectorAll('.patient-node');
    
    patientNodes.forEach(node => {
        const title = node.querySelector('.patient-title').textContent.toLowerCase();
        const subtitle = node.querySelector('.patient-subtitle').textContent.toLowerCase();
        
        let match = title.includes(query) || subtitle.includes(query);
        
        // Check inside series items
        const seriesItems = node.querySelectorAll('.series-item');
        let seriesMatch = false;
        seriesItems.forEach(item => {
            const itemText = item.textContent.toLowerCase();
            if (itemText.includes(query)) {
                seriesMatch = true;
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
        
        if (match || seriesMatch) {
            node.style.display = 'block';
            if (query !== '' && seriesMatch) {
                node.classList.add('expanded');
                // Ensure studies-list displays
                node.querySelector('.studies-list').style.display = 'block';
            }
        } else {
            node.style.display = 'none';
        }
    });
}

// Load a Series
function loadSeries(patient, study, series) {
    stopCinePlay();
    closeAiPanel(); // Close AI panel and clean states when a new series loads
    
    appState.currentSeries = series;
    appState.currentSlices = series.slices;
    appState.currentIndex = 0;
    
    // Set slider range limits
    els.sliceRange.max = series.slice_count - 1;
    els.sliceRange.min = 0;
    els.sliceRange.value = 0;
    
    // Reset window preset selector to default DICOM headers values
    els.windowPreset.value = 'default';
    
    // Set Corner Overlays
    els.patientNameOverlay.textContent = patient.name.toUpperCase();
    els.patientIdOverlay.textContent = `ID: ${patient.id}`;
    
    let age = 'Unknown';
    els.patientBirthOverlay.textContent = `DOB: --`;
    
    // Study metadata
    let dateStr = study.date;
    if (dateStr && dateStr.length === 8) {
        dateStr = `${dateStr.substring(0,4)}-${dateStr.substring(4,6)}-${dateStr.substring(6,8)}`;
    } else {
        dateStr = 'Unknown Date';
    }
    
    els.studyDateOverlay.textContent = `DATE: ${dateStr}`;
    els.studyDescOverlay.textContent = `DESC: ${study.description}`;
    els.modalityOverlay.textContent = series.modality;
    
    // Show image container, hide placeholder
    els.viewportPlaceholder.classList.add('hidden');
    els.dicomImg.style.display = 'block';
    
    resetViewportTransform();
    
    // Pre-calculate windowing center and width values from the first slice
    // Fetch DICOM headers metadata immediately to grab original WC/WW
    fetchMetadataAndSetupWindowing(series.slices[0].filepath);
}

// Fetch slice headers to initialize windowing center & width
function fetchMetadataAndSetupWindowing(filepath) {
    els.viewportLoader.classList.remove('hidden');
    
    fetch(`/api/metadata?filepath=${encodeURIComponent(filepath)}`)
    .then(res => res.json())
    .then(tags => {
        appState.currentTags = tags;
        
        // Find window center and window width in tags
        let wc = null;
        let ww = null;
        
        const wcTag = tags.find(t => t.tag === '(0028,1050)');
        const wwTag = tags.find(t => t.tag === '(0028,1051)');
        
        if (wcTag && wcTag.value) {
            wc = parseFloat(wcTag.value.split('\\')[0]); // Take first if multiple
        }
        if (wwTag && wwTag.value) {
            ww = parseFloat(wwTag.value.split('\\')[0]);
        }
        
        // Fallback if not specified in headers
        appState.originalCenter = wc !== null && !isNaN(wc) ? Math.round(wc) : 40;
        appState.originalWidth = ww !== null && !isNaN(ww) ? Math.round(ww) : 400;
        
        // Update sliders defaults
        appState.windowCenter = appState.originalCenter;
        appState.windowWidth = appState.originalWidth;
        
        // Adjust manual sliders limits according to bounds
        els.wcSlider.min = appState.originalCenter - 1500;
        els.wcSlider.max = appState.originalCenter + 1500;
        els.wwSlider.min = 1;
        els.wwSlider.max = appState.originalWidth + 3000;
        
        syncWindowSliders();
        loadSlice(appState.currentIndex);
        startPreloading();
    })
    .catch(err => {
        console.error('Error fetching metadata:', err);
        // Fallback load slice anyway
        appState.windowCenter = 40;
        appState.windowWidth = 400;
        syncWindowSliders();
        loadSlice(appState.currentIndex);
        startPreloading();
    });
}

// Load a specific Slice from array index
function loadSlice(index) {
    if (!appState.currentSlices || appState.currentSlices.length === 0) return;
    
    appState.currentIndex = index;
    els.sliceRange.value = index;
    
    const slice = appState.currentSlices[index];
    
    // Update corners info
    els.sliceIndexOverlay.textContent = `Slice: ${index + 1} / ${appState.currentSlices.length}`;
    els.sliceLocOverlay.textContent = `Loc: ${slice.location.toFixed(2)} mm`;
    
    els.viewportLoader.classList.remove('hidden');
    
    // Update image source path (includes dynamic WC/WW parameters)
    updateSliceImage();
    
    // Update inspector metadata tags table asynchronously
    updateMetadataTags(slice.filepath);
    
    // Update AI panel details for this specific slice
    updateAiPanelDetails();
}

// Update slice image source with current windowing
function updateSliceImage() {
    if (!appState.currentSlices || appState.currentSlices.length === 0) return;
    
    const slice = appState.currentSlices[appState.currentIndex];
    
    // Check if we should request drawing the AI anomaly highlights for this specific slice
    let showAnomaly = false;
    if (appState.showAiHighlight && appState.aiResults && appState.aiResults.results) {
        const sliceResult = appState.aiResults.results[slice.filepath];
        showAnomaly = sliceResult && sliceResult.has_issue;
    }
    
    // Build image URL with parameters to adjust window center/width dynamically on backend
    const imgUrl = `/api/image?filepath=${encodeURIComponent(slice.filepath)}&wc=${appState.windowCenter}&ww=${appState.windowWidth}&show_anomaly=${showAnomaly}&t=${Date.now()}`;
    
    els.dicomImg.onload = () => {
        els.viewportLoader.classList.add('hidden');
    };
    
    els.dicomImg.onerror = () => {
        els.viewportLoader.classList.add('hidden');
        console.error('Failed to load image slice from server.');
    };
    
    els.dicomImg.src = imgUrl;
    
    // Display overlays
    els.wcOverlay.textContent = `WC: ${appState.windowCenter}`;
    els.wwOverlay.textContent = `WW: ${appState.windowWidth}`;
    
    // Sync slider displays
    els.wcValue.textContent = appState.windowCenter;
    els.wwValue.textContent = appState.windowWidth;
}

let updatePending = false;
function updateSliceImageThrottled() {
    if (updatePending) return;
    updatePending = true;
    requestAnimationFrame(() => {
        updateSliceImage();
        updatePending = false;
    });
}

// Sequentially prefetch adjacent slices into browser memory cache
function startPreloading() {
    if (!appState.currentSlices || appState.currentSlices.length === 0) return;
    
    appState.preloadQueue = [];
    
    const totalSlices = appState.currentSlices.length;
    const current = appState.currentIndex;
    const wc = appState.windowCenter;
    const ww = appState.windowWidth;
    
    // Sort slice indices by proximity to current index
    let indices = [];
    for (let i = 0; i < totalSlices; i++) {
        if (i !== current) {
            indices.push(i);
        }
    }
    indices.sort((a, b) => Math.abs(a - current) - Math.abs(b - current));
    
    appState.preloadQueue = indices;
    
    if (!appState.isPreloading) {
        processPreloadQueue();
    }
}

function processPreloadQueue() {
    if (appState.preloadQueue.length === 0) {
        appState.isPreloading = false;
        return;
    }
    
    appState.isPreloading = true;
    const nextIndex = appState.preloadQueue.shift();
    const slice = appState.currentSlices[nextIndex];
    const wc = appState.windowCenter;
    const ww = appState.windowWidth;
    
    const imgUrl = `/api/image?filepath=${encodeURIComponent(slice.filepath)}&wc=${wc}&ww=${ww}`;
    
    const img = new Image();
    img.onload = img.onerror = () => {
        // Yield thread, then queue next prefetch
        setTimeout(processPreloadQueue, 5);
    };
    img.src = imgUrl;
}

// Update metadata tags panel table
function updateMetadataTags(filepath) {
    fetch(`/api/metadata?filepath=${encodeURIComponent(filepath)}`)
    .then(res => res.json())
    .then(tags => {
        appState.currentTags = tags;
        renderMetadataTags();
    })
    .catch(err => {
        console.error('Error fetching metadata tags:', err);
    });
}

// Render metadata tags to UI Table
function renderMetadataTags() {
    const tbody = els.tagsTbody;
    tbody.innerHTML = '';
    
    const query = els.tagSearch.value.toLowerCase().trim();
    
    let filteredTags = appState.currentTags;
    if (query !== '') {
        filteredTags = appState.currentTags.filter(t => 
            t.tag.toLowerCase().includes(query) || 
            t.name.toLowerCase().includes(query) || 
            t.value.toLowerCase().includes(query)
        );
    }
    
    els.tagCount.textContent = `${filteredTags.length} Tags`;
    
    if (filteredTags.length === 0) {
        tbody.innerHTML = `<tr><td colspan="2" class="empty-table-state">No matching tags found</td></tr>`;
        return;
    }
    
    filteredTags.forEach(tag => {
        const row = document.createElement('tr');
        // Clean values to avoid quote escaping issues in HTML title attributes
        const escapeVal = tag.value.replace(/"/g, '&quot;');
        const escapeName = tag.name.replace(/"/g, '&quot;');
        
        // Merge name and tag coordinates for compact display
        const combinedTitle = `${tag.name} ${tag.tag}`.replace(/"/g, '&quot;');
        
        row.innerHTML = `
            <td title="${combinedTitle}">
                ${tag.name}
                <div style="color: var(--text-muted); font-size: 0.65rem; font-family: 'JetBrains Mono', monospace; margin-top: 2px;">${tag.tag}</div>
            </td>
            <td title="${escapeVal}">${tag.value}</td>
        `;
        tbody.appendChild(row);
    });
}

// Filter Metadata table
function filterMetadataTags() {
    renderMetadataTags();
}

// Sync values to sliders inputs
function syncWindowSliders() {
    els.wcSlider.value = appState.windowCenter;
    els.wwSlider.value = appState.windowWidth;
    els.wcValue.textContent = appState.windowCenter;
    els.wwValue.textContent = appState.windowWidth;
}

// Presets Selector handler
function handlePresetChange() {
    const val = els.windowPreset.value;
    if (val === 'default') {
        appState.windowCenter = appState.originalCenter;
        appState.windowWidth = appState.originalWidth;
    } else if (PRESETS[val]) {
        appState.windowCenter = PRESETS[val].wc;
        appState.windowWidth = PRESETS[val].ww;
    }
    
    syncWindowSliders();
    updateSliceImage();
    startPreloading();
}

// Play Cine Loop
function toggleCinePlay() {
    if (appState.isPlaying) {
        stopCinePlay();
    } else {
        startCinePlay();
    }
}

function startCinePlay() {
    if (appState.currentSlices.length <= 1) return;
    
    appState.isPlaying = true;
    els.playIcon.classList.add('hidden');
    els.pauseIcon.classList.remove('hidden');
    
    const intervalTime = 1000 / appState.fps;
    appState.cineInterval = setInterval(() => {
        nextSlice();
    }, intervalTime);
}

function stopCinePlay() {
    appState.isPlaying = false;
    els.playIcon.classList.remove('hidden');
    els.pauseIcon.classList.add('hidden');
    
    if (appState.cineInterval) {
        clearInterval(appState.cineInterval);
        appState.cineInterval = null;
    }
}

// Slices Navigation
function nextSlice() {
    if (appState.currentSlices.length === 0) return;
    let nextIdx = appState.currentIndex + 1;
    if (nextIdx >= appState.currentSlices.length) {
        nextIdx = 0; // Wrap around
    }
    loadSlice(nextIdx);
}

function prevSlice() {
    if (appState.currentSlices.length === 0) return;
    let prevIdx = appState.currentIndex - 1;
    if (prevIdx < 0) {
        prevIdx = appState.currentSlices.length - 1; // Wrap around
    }
    loadSlice(prevIdx);
}

// Reset Viewport zoom and pan
function resetViewportTransform() {
    appState.zoom = 1;
    appState.panX = 0;
    appState.panY = 0;
    updateViewportTransform();
}

// Apply transforms to image element
function updateViewportTransform() {
    els.dicomImg.style.transform = `translate(${appState.panX}px, ${appState.panY}px) scale(${appState.zoom})`;
    els.zoomOverlay.textContent = `Zoom: ${Math.round(appState.zoom * 100)}%`;
}

// Dragging Interactions
function handleMouseDown(e) {
    if (appState.currentSlices.length === 0) return;
    
    appState.isDragging = true;
    appState.startX = e.clientX;
    appState.startY = e.clientY;
    
    e.preventDefault();
}

function handleMouseMove(e) {
    if (!appState.isDragging) return;
    
    const dx = e.clientX - appState.startX;
    const dy = e.clientY - appState.startY;
    
    // Save last coords
    appState.startX = e.clientX;
    appState.startY = e.clientY;
    
    if (appState.activeTool === 'zoom') {
        // Zoom if holding Shift, otherwise Pan
        if (e.shiftKey) {
            appState.zoom += dy * -0.005;
            appState.zoom = Math.max(0.1, Math.min(appState.zoom, 10)); // bounds
            updateViewportTransform();
        } else {
            appState.panX += dx;
            appState.panY += dy;
            updateViewportTransform();
        }
    } else if (appState.activeTool === 'window') {
        // Horizontal changes Width, Vertical changes Center
        appState.windowWidth += dx * 2;
        appState.windowCenter -= dy * 2;
        
        appState.windowWidth = Math.max(1, appState.windowWidth);
        
        els.wcSlider.value = appState.windowCenter;
        els.wwSlider.value = appState.windowWidth;
        els.wcValue.textContent = appState.windowCenter;
        els.wwValue.textContent = appState.windowWidth;
        
        // Update overlays text immediately
        els.wcOverlay.textContent = `WC: ${appState.windowCenter}`;
        els.wwOverlay.textContent = `WW: ${appState.windowWidth}`;
        
        // Apply temporary GPU-accelerated CSS filter for instant feedback
        let contrastFactor = appState.originalWidth / appState.windowWidth;
        let brightnessFactor = 1.0 - (appState.windowCenter - appState.originalCenter) / appState.originalWidth;
        els.dicomImg.style.filter = `brightness(${Math.max(0.2, brightnessFactor)}) contrast(${Math.max(0.2, contrastFactor)})`;
    } else if (appState.activeTool === 'scroll') {
        // Scroll slice on Y dragging delta
        if (Math.abs(dy) > 10) {
            if (dy > 0) {
                prevSlice();
            } else {
                nextSlice();
            }
            appState.startY = e.clientY; // Reset to avoid fast jumping
        }
    }
}

function handleMouseUp(e) {
    if (appState.isDragging) {
        appState.isDragging = false;
        
        // If we were windowing, fetch the final high-quality image from the backend
        if (appState.activeTool === 'window') {
            els.dicomImg.style.filter = 'none'; // reset CSS filter
            updateSliceImage();
            
            // Re-preload adjacent slices with the new WC/WW setting!
            startPreloading();
        }
    }
}

// Wheel Scrolling
function handleMouseWheel(e) {
    if (appState.currentSlices.length === 0) return;
    e.preventDefault();
    
    if (appState.activeTool === 'zoom') {
        // Zoom at mouse position or center
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        appState.zoom *= zoomFactor;
        appState.zoom = Math.max(0.1, Math.min(appState.zoom, 10));
        updateViewportTransform();
    } else {
        // Default scroll slices
        if (e.deltaY < 0) {
            prevSlice();
        } else {
            nextSlice();
        }
    }
}

// Keyboard shortcuts handlers
function handleKeyDown(e) {
    const activeEl = document.activeElement;
    // Don't trigger keyboard shortcuts when typing in inputs
    if (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') {
        return;
    }
    
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            toggleCinePlay();
            break;
        case 'ArrowUp':
        case 'ArrowLeft':
            e.preventDefault();
            prevSlice();
            break;
        case 'ArrowDown':
        case 'ArrowRight':
            e.preventDefault();
            nextSlice();
            break;
        case 'KeyW':
            // Window Center Up
            appState.windowCenter += 5;
            syncWindowSliders();
            updateSliceImage();
            break;
        case 'KeyS':
            // Window Center Down
            appState.windowCenter -= 5;
            syncWindowSliders();
            updateSliceImage();
            break;
        case 'KeyD':
            // Window Width Up
            appState.windowWidth += 10;
            syncWindowSliders();
            updateSliceImage();
            break;
        case 'KeyA':
            // Window Width Down
            appState.windowWidth = Math.max(1, appState.windowWidth - 10);
            syncWindowSliders();
            updateSliceImage();
            break;
        case 'KeyH':
            toggleHelpModal();
            break;
        case 'KeyT':
            toggleTagsSidebar();
            break;
        case 'Escape':
            if (!els.helpModal.classList.contains('hidden')) {
                toggleHelpModal();
            }
            break;
    }
}

// Help Modal Toggle
function toggleHelpModal() {
    els.helpModal.classList.toggle('hidden');
}

// Helper: Reset Viewport placeholders
function resetViewportUI() {
    els.viewportPlaceholder.classList.remove('hidden');
    els.dicomImg.style.display = 'none';
    
    els.patientNameOverlay.textContent = 'NO SERIES LOADED';
    els.patientIdOverlay.textContent = 'ID: --';
    els.patientBirthOverlay.textContent = 'DOB: --';
    
    els.studyDateOverlay.textContent = 'DATE: --';
    els.studyDescOverlay.textContent = 'DESC: --';
    els.modalityOverlay.textContent = 'MODALITY: --';
    
    els.sliceIndexOverlay.textContent = 'Slice: 0 / 0';
    els.sliceLocOverlay.textContent = 'Loc: 0.00 mm';
    els.zoomOverlay.textContent = 'Zoom: 100%';
    
    els.wcOverlay.textContent = 'WC: --';
    els.wwOverlay.textContent = 'WW: --';
    
    // Clear AI overlays
    els.aiFindingBanner.classList.add('hidden');
    els.sliceAiStatus.textContent = '';
    els.sliceAiStatus.className = 'slice-ai-status';
    els.scrubberMarkers.innerHTML = '';
    
    els.tagCount.textContent = '0 Tags';
    els.tagsTbody.innerHTML = `<tr><td colspan="3" class="empty-table-state">No slice selected</td></tr>`;
}

function runAiAnalysis() {
    if (!appState.currentSlices || appState.currentSlices.length === 0) return;
    if (appState.isAiAnalyzing) return;
    
    appState.isAiAnalyzing = true;
    els.aiAnalyzeBtn.disabled = true;
    els.aiAnalyzeBtn.textContent = 'Analyzing...';
    els.aiAnalyzeBtn.classList.add('active');
    
    const seriesNum = appState.currentSeries ? appState.currentSeries.number : '?';
    console.log(`Starting AI Analyze for ${appState.currentSlices.length} slices of Series ${seriesNum}`);
    
    // Show spinner overlay with AI status
    els.viewportLoader.classList.remove('hidden');
    const loadingText = els.viewportLoader.querySelector('p');
    const originalText = loadingText.textContent;
    loadingText.textContent = `AI Volumetric Scanning (Series ${seriesNum})...`;
    
    const filepaths = appState.currentSlices.map(s => s.filepath);
    
    fetch('/api/analyze', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filepaths: filepaths })
    })
    .then(res => res.json())
    .then(data => {
        appState.isAiAnalyzing = false;
        els.aiAnalyzeBtn.disabled = false;
        els.aiAnalyzeBtn.textContent = 'AI Analyze';
        loadingText.textContent = originalText;
        els.viewportLoader.classList.add('hidden');
        
        if (!data.success) {
            alert('AI Diagnostics failed: ' + data.error);
            els.aiAnalyzeBtn.classList.remove('active');
            return;
        }
        
        appState.aiResults = data;
        
        // Show panel
        els.aiResultsPanel.classList.remove('hidden');
        
        // Render timeline ticks and anomalies list
        buildAiTimelineMarkersAndList();
        
        // Populate fields for this specific slice
        updateAiPanelDetails();
        
        // Trigger image reload to draw the bounding box
        updateSliceImage();
    })
    .catch(err => {
        appState.isAiAnalyzing = false;
        els.aiAnalyzeBtn.disabled = false;
        els.aiAnalyzeBtn.textContent = 'AI Analyze';
        els.aiAnalyzeBtn.classList.remove('active');
        loadingText.textContent = originalText;
        els.viewportLoader.classList.add('hidden');
        alert('Connection error during AI analysis: ' + err.message);
    });
}

// Build timeline scrubber markers and side panel list of findings
function buildAiTimelineMarkersAndList() {
    if (!appState.aiResults || !appState.aiResults.results || appState.currentSlices.length === 0) return;
    
    els.scrubberMarkers.innerHTML = '';
    els.aiFindingsList.innerHTML = '';
    
    const N = appState.currentSlices.length;
    let anomalyCount = 0;
    const seriesNum = appState.currentSeries ? appState.currentSeries.number : '?';
    
    appState.currentSlices.forEach((slice, i) => {
        const result = appState.aiResults.results[slice.filepath];
        if (result && result.has_issue) {
            anomalyCount++;
            
            // 1. Create scrubber timeline ticks
            const pct = N > 1 ? (i / (N - 1)) * 100 : 0;
            const tick = document.createElement('div');
            tick.className = 'scrubber-tick';
            tick.style.left = `${pct}%`;
            tick.dataset.sliceIndex = i;
            const boxLabel = result.box ? result.box.label : "Anomaly";
            tick.title = `Series ${seriesNum} Slice ${i + 1}: ${boxLabel}`;
            
            // Add click listener to scrubber tick to jump directly to that slice
            tick.addEventListener('click', (e) => {
                e.stopPropagation();
                stopCinePlay();
                const targetIdx = parseInt(e.currentTarget.dataset.sliceIndex);
                console.log("Scrubber tick clicked, loading slice index:", targetIdx);
                loadSlice(targetIdx);
            });
            els.scrubberMarkers.appendChild(tick);
            
            // 2. Create list items for AI sidebar panel
            const item = document.createElement('div');
            item.className = 'ai-finding-item';
            item.dataset.sliceIndex = i;
            
            // Form short finding label for list
            let briefText = boxLabel;
            if (result.findings) {
                // Strip redundant text for clean tag
                briefText = result.findings.split('.')[0];
            }
            
            item.innerHTML = `
                <span class="ai-finding-item-text" title="${result.findings}">${briefText}</span>
                <span class="ai-finding-item-index">SE ${seriesNum} • SL ${i + 1}</span>
            `;
            
            item.addEventListener('click', (e) => {
                stopCinePlay();
                const targetIdx = parseInt(e.currentTarget.dataset.sliceIndex);
                console.log("Anomaly list item clicked, loading slice index:", targetIdx);
                loadSlice(targetIdx);
            });
            
            els.aiFindingsList.appendChild(item);
        }
    });
    
    // Update findings list container heading count
    els.aiListTitle.textContent = `Series ${seriesNum} Anomalies (${anomalyCount}):`;
    
    if (anomalyCount > 0) {
        els.aiFindingsListBox.classList.remove('hidden');
    } else {
        els.aiFindingsListBox.classList.add('hidden');
    }
}

function closeAiPanel() {
    els.aiResultsPanel.classList.add('hidden');
    els.aiAnalyzeBtn.classList.remove('active');
    appState.aiResults = null;
    
    // Reset AI elements in UI
    els.aiFindingBanner.classList.add('hidden');
    els.aiFindingBannerText.textContent = '';
    els.scrubberMarkers.innerHTML = '';
    els.aiFindingsListBox.classList.add('hidden');
    els.aiFindingsList.innerHTML = '';
    els.sliceAiStatus.textContent = '';
    els.sliceAiStatus.className = 'slice-ai-status';
    
    // Reload image to strip away highlight box
    updateSliceImage();
}

function updateAiPanelDetails() {
    if (!appState.aiResults || !appState.aiResults.results || appState.currentSlices.length === 0) {
        els.aiFindingBanner.classList.add('hidden');
        els.sliceAiStatus.textContent = '';
        return;
    }
    
    const slice = appState.currentSlices[appState.currentIndex];
    const result = appState.aiResults.results[slice.filepath];
    
    // Update active highlight in anomalies side list
    document.querySelectorAll('.ai-finding-item').forEach(item => {
        if (parseInt(item.dataset.sliceIndex) === appState.currentIndex) {
            item.classList.add('active');
            try {
                item.scrollIntoView({ block: 'nearest', behavior: 'auto' });
            } catch (err) {
                // Fallback if options not supported
                item.scrollIntoView();
            }
        } else {
            item.classList.remove('active');
        }
    });
    
    if (result) {
        if (result.has_issue) {
            els.aiStatusVal.textContent = 'Anomaly Detected';
            els.aiStatusVal.className = 'ai-status-value badge-danger';
            
            // Render Viewport alert banner
            els.aiFindingBanner.classList.remove('hidden');
            const boxLabel = result.box ? result.box.label : "Anomaly";
            els.aiFindingBannerText.textContent = `${boxLabel}: ${result.findings}`;
            
            // Update slice metadata corner overlay status
            els.sliceAiStatus.textContent = `🔴 AI: ${boxLabel}`;
            els.sliceAiStatus.className = 'slice-ai-status status-danger';
        } else {
            els.aiStatusVal.textContent = 'Normal';
            els.aiStatusVal.className = 'ai-status-value badge-success';
            
            // Hide banner since scan is normal
            els.aiFindingBanner.classList.add('hidden');
            
            // Update corner overlay status
            els.sliceAiStatus.textContent = '🟢 AI: Normal';
            els.sliceAiStatus.className = 'slice-ai-status status-success';
        }
        els.aiFindingsText.textContent = result.findings;
        els.aiRecText.textContent = result.recommendation;
    } else {
        els.aiStatusVal.textContent = 'Not Scanned';
        els.aiStatusVal.className = 'ai-status-value';
        els.aiFindingsText.textContent = 'No diagnostics for this slice.';
        els.aiRecText.textContent = 'Click AI Analyze to perform scanning.';
        
        els.aiFindingBanner.classList.add('hidden');
        els.sliceAiStatus.textContent = '';
        els.sliceAiStatus.className = 'slice-ai-status';
    }
}

function toggleTagsSidebar() {
    document.body.classList.toggle('tags-collapsed');
    const isCollapsed = document.body.classList.contains('tags-collapsed');
    els.toggleTagsBtn.classList.toggle('active', isCollapsed);
    els.toggleTagsBtn.innerHTML = isCollapsed ? 
        `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg> <span>Show Tags</span>` :
        `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg> <span>Hide Tags</span>`;
}
