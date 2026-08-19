// =============================================================================
// CANASTA LIBANAISE — CLIENT JS (PURE CSS CARDS - PREMIUM LAYOUT)
// =============================================================================

class GestionnaireSons {
    constructor() {
        this.ctx = null;
        this.sons = {};
        this.verrouInit = false;
        
        const frequences = {
            'carte': [400, 0.05, 'sine'],
            'piocher': [500, 0.1, 'sine'],
            'jeter': [300, 0.1, 'triangle'],
            'select': [800, 0.05, 'sine'],
            'erreur': [150, 0.3, 'sawtooth'],
            'succes': [600, 0.2, 'sine'],
            'victoire': [440, 0.5, 'square']
        };
        this.frequences = frequences;

        const declencherInit = () => {
            this.init();
            document.removeEventListener('click', declencherInit);
            document.removeEventListener('touchstart', declencherInit);
        };
        document.addEventListener('click', declencherInit);
        document.addEventListener('touchstart', declencherInit);
    }

    init() {
        if (this.ctx || this.verrouInit) return;
        this.verrouInit = true;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn("AudioContext non supporté.");
        }
    }

    jouer(nom) {
        if (!this.ctx || this.ctx.state !== 'running') return;
        const config = this.frequences[nom] || this.frequences['carte'];
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = config[2];
        osc.frequency.setValueAtTime(config[0], this.ctx.currentTime);
        if (nom === 'victoire') {
            osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.3);
            osc.frequency.exponentialRampToValueAtTime(1100, this.ctx.currentTime + 0.5);
        } else if (nom === 'succes') {
            osc.frequency.setValueAtTime(600, this.ctx.currentTime);
            osc.frequency.setValueAtTime(800, this.ctx.currentTime + 0.1);
        } else if (nom === 'erreur') {
            osc.frequency.linearRampToValueAtTime(100, this.ctx.currentTime + config[1]);
        }
        
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + config[1]);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + config[1]);
    }
}

const sons = new GestionnaireSons();
const socket = io();

// =============================================================================
// ÉTAT GLOBAL
// =============================================================================
let ecranActuel = 'lobby'; // lobby | salon | jeu
let monNumero = null;
let estSpectateur = false;
let cartesSelectionnees = new Set();
let etatGlobal = null;
let localHandOrder = []; // Stores card IDs in user-sorted order

// Mécanique de double tap
let dernierTap = {};
const DOUBLE_TAP_MS = 300;
let verrouAction = false;

// =============================================================================
// UTILITAIRES UI
// =============================================================================
function afficherEcran(idEcran) {
    document.getElementById('ecran-lobby').style.display = 'none';
    document.getElementById('ecran-salon').style.display = 'none';
    document.getElementById('ecran-jeu').style.display = 'none';
    document.getElementById(`ecran-${idEcran}`).style.display = 'flex';
    ecranActuel = idEcran;
    
    if (idEcran === 'jeu' && screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(e => console.log('Orientation lock not supported', e));
    }
}

function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}

// =============================================================================
// RÉSEAU : ÉCRANS LOBBY & SALON
// =============================================================================
document.getElementById('btn-creer-salon').addEventListener('click', () => {
    const nom = document.getElementById('input-nom-salon').value.trim();
    socket.emit('creerSalon', nom);
});

socket.on('listeSalons', (salons) => {
    const liste = document.getElementById('liste-salons');
    liste.innerHTML = '';
    if (salons.length === 0) {
        liste.innerHTML = '<p class="texte-vide">Aucun salon disponible. Créez-en un !</p>';
        return;
    }
    salons.forEach(s => {
        const div = document.createElement('div');
        div.className = 'salon-item';
        div.innerHTML = `
            <div><strong>${s.nom}</strong> (${s.nbJoueurs}/4)</div>
            <button class="btn btn-blue" ${s.nbJoueurs >= 4 || s.enCours ? 'disabled' : ''}>Rejoindre</button>
        `;
        div.querySelector('button').addEventListener('click', () => socket.emit('rejoindreSalon', s.id));
        liste.appendChild(div);
    });
});

socket.on('salonCree', (donnees) => rejoindreInterfaceSalon(donnees));
socket.on('salonRejoins', (donnees) => rejoindreInterfaceSalon(donnees));

function rejoindreInterfaceSalon(donnees) {
    afficherEcran('salon');
    document.getElementById('titre-salon').textContent = donnees.nom;
    estSpectateur = donnees.monNumero === null;
    mettreAJourSieges(donnees.joueurs, donnees.hote);
}

socket.on('miseAJourSalon', (donnees) => {
    if (ecranActuel === 'salon') {
        mettreAJourSieges(donnees.joueurs, donnees.hote);
    }
});

function mettreAJourSieges(joueurs, hote) {
    const grille = document.getElementById('grille-sieges');
    grille.innerHTML = '';
    const mapJoueurs = {};
    joueurs.forEach(j => mapJoueurs[j.numero] = j);

    for (let i = 1; i <= 4; i++) {
        const div = document.createElement('div');
        div.className = 'siege';
        if (mapJoueurs[i]) {
            div.classList.add('occupe');
            div.innerHTML = `<strong>Joueur ${i}</strong><br>${mapJoueurs[i].nom} ${mapJoueurs[i].estBot ? '🤖' : '👤'}`;
        } else {
            div.innerHTML = `<strong>Joueur ${i}</strong><br><span style="color:#777">Vide</span>`;
        }
        grille.appendChild(div);
    }

    const estHote = socket.id === hote;
    document.getElementById('btn-demarrer').style.display = estHote ? 'block' : 'none';
    document.getElementById('btn-ajouter-bot').style.display = estHote ? 'block' : 'none';
}

document.getElementById('btn-ajouter-bot').addEventListener('click', () => socket.emit('ajouterBot'));
document.getElementById('btn-demarrer').addEventListener('click', () => socket.emit('demarrerPartie'));
document.getElementById('btn-quitter-salon').addEventListener('click', () => {
    socket.emit('quitterSalon');
    afficherEcran('lobby');
    socket.emit('listerSalons');
});

socket.on('salonErreur', (msg) => toast(msg, 'error'));
socket.on('alerteJeu', (msg) => { 
    toast(msg, msg.includes('Erreur') || msg.includes('Impossible') || msg.includes('invalide') ? 'error' : 'info'); 
    sons.jouer('erreur'); 
    
    // Check if this is a failed opening
    if (msg.includes("droit d'ouvrir")) {
        modeErreurPreparation = true;
        mettreAJourBoutons();
    }
});

socket.on('messageGlobal', (msg) => toast(msg, 'info'));

// Chat events
document.getElementById('btn-envoyer-chat').addEventListener('click', () => {
    const input = document.getElementById('input-chat');
    if (input.value.trim()) {
        socket.emit('chatMessage', input.value.trim());
        input.value = '';
    }
});
document.getElementById('input-chat').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-envoyer-chat').click();
});
socket.on('nouveauMessage', (data) => {
    const container = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'chat-message';
    el.innerHTML = `<span class="sender">${data.expediteur}</span>: ${data.message} <span class="time">${data.time}</span>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
});

// Emoji events
const btnEmoji = document.getElementById('btn-emoji'); if(btnEmoji) btnEmoji.addEventListener('click', () => {
    const panel = document.getElementById('panneau-emojis');
    panel.style.display = panel.style.display === 'none' ? 'grid' : 'none';
});
document.querySelectorAll('.emoji-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
        socket.emit('envoyerEmoji', e.target.textContent);
        document.getElementById('panneau-emojis').style.display = 'none';
    });
});
socket.on('recevoirEmoji', (data) => {
    // Show floating emoji from the player's seat position
    const positions = {
        'adv-haut': { top: '10%', left: '50%' },
        'adv-gauche': { top: '50%', left: '10%' },
        'adv-droite': { top: '50%', right: '10%' },
        'zone-main': { bottom: '20%', left: '50%' }
    };
    
    let positionStr = positions['adv-haut']; // default
    if (etatGlobal) {
        if (data.numeroJoueur === monNumero) positionStr = positions['zone-main'];
        else {
            const gauche = (monNumero % 4) + 1;
            const droite = ((monNumero + 2) % 4) + 1;
            if (data.numeroJoueur === gauche) positionStr = positions['adv-gauche'];
            if (data.numeroJoueur === droite) positionStr = positions['adv-droite'];
        }
    }
    
    const floatEl = document.createElement('div');
    floatEl.className = 'emoji-flottant';
    floatEl.textContent = data.emoji;
    Object.assign(floatEl.style, positionStr);
    
    document.getElementById('ecran-jeu').appendChild(floatEl);
    setTimeout(() => floatEl.remove(), 2000);
});



// =============================================================================
// JEU : ACTIONS DE BOUTONS
// =============================================================================

// Force text onto buttons in case index.html is cached with old emojis
window.addEventListener('DOMContentLoaded', () => {
    const btnSortir = document.getElementById('btn-sortir');
    const btnPoser = document.getElementById('btn-poser');
    if (btnSortir) btnSortir.textContent = 'SORTIR';
    if (btnPoser) btnPoser.textContent = 'POSER';
    window.addEventListener('resize', applyDynamicOverlap);
});

document.getElementById('btn-sortir').addEventListener('click', () => {
    socket.emit('demandeSortir');
});

function autoGroupCartes(ids, extraCard = null) {
    let selected = ids.map(id => etatGlobal.maMain.find(c => c.id === id)).filter(Boolean);
    if (extraCard) selected.push(extraCard);
    let byValue = {};
    let wildcards = [];
    
    selected.forEach(c => {
        if (c.valeur === 'Joker' || c.valeur === '2') wildcards.push(c);
        else {
            if (!byValue[c.valeur]) byValue[c.valeur] = [];
            byValue[c.valeur].push(c);
        }
    });

    let groups = [];
    Object.keys(byValue).forEach(v => {
        groups.push({ valeur: v, cartesId: byValue[v].map(c => c.id) });
    });

    for (let w of wildcards) {
        let added = false;
        for (let g of groups) {
            if (g.cartesId.length < 3) { g.cartesId.push(w.id); added = true; break; }
        }
        if (!added && groups.length > 0) {
            groups[0].cartesId.push(w.id);
        } else if (!added) {
            groups.push({ valeur: '2', cartesId: [w.id] });
        }
    }

    return groups;
}

// =============================================================================
// TRI INTELLIGENT DE LA MAIN (style Jawaker)
// Groupes du plus petit au plus grand, wildcards ensemble à la fin
// =============================================================================
function trierMainIntelligent(main) {
    const troisRouges = [];
    const troisNoirs = [];
    const parValeur = {};
    const wildcards = [];

    const ordreVal = { '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, 'V': 9, 'D': 10, 'R': 11, 'A': 12 };

    main.forEach(c => {
        if (c.valeur === '3' && (c.couleur === 'Coeur' || c.couleur === 'Carreau')) {
            troisRouges.push(c);
        } else if (c.valeur === '3' && (c.couleur === 'Trefle' || c.couleur === 'Pique')) {
            troisNoirs.push(c);
        } else if (c.valeur === 'Joker' || c.valeur === '2') {
            wildcards.push(c);
        } else {
            if (!parValeur[c.valeur]) parValeur[c.valeur] = [];
            parValeur[c.valeur].push(c);
        }
    });

    // Jokers d'abord parmi les wildcards
    wildcards.sort((a, b) => {
        if (a.valeur === 'Joker' && b.valeur !== 'Joker') return -1;
        if (a.valeur !== 'Joker' && b.valeur === 'Joker') return 1;
        return 0;
    });

    // Groupes triés par taille CROISSANTE, puis par valeur croissante
    let groupes = Object.entries(parValeur).map(([val, cartes]) => ({
        valeur: val,
        cartes: cartes.slice(),
        ordre: ordreVal[val] || 0
    }));

    groupes.sort((a, b) => {
        if (a.cartes.length !== b.cartes.length) return a.cartes.length - b.cartes.length;
        return a.ordre - b.ordre;
    });

    // Séparer les cartes isolées (singles) des vrais groupes (2+)
    const singles = [];
    const vraisGroupes = [];
    groupes.forEach(g => {
        if (g.cartes.length === 1) singles.push(g.cartes[0]);
        else vraisGroupes.push(g);
    });

    // Résultat : groupes naturels, puis wildcards ensemble, puis singles, puis 3 noirs
    let result = [];
    if (troisRouges.length > 0) result.push({ cartes: troisRouges, type: 'troisRouges' });
    vraisGroupes.forEach(g => result.push({ cartes: g.cartes, type: 'groupe' }));
    if (wildcards.length > 0) result.push({ cartes: wildcards, type: 'wildcards' });
    if (singles.length > 0) result.push({ cartes: singles, type: 'singles' });
    if (troisNoirs.length > 0) result.push({ cartes: troisNoirs, type: 'troisNoirs' });

    return result;
}

function evaluerSelection() {
    if (cartesSelectionnees.size === 0) return { valide: false };
    
    let selectedCartes = [];
    cartesSelectionnees.forEach(id => {
        const c = etatGlobal.maMain.find(carte => carte.id === id);
        if (c) selectedCartes.push(c);
    });
    
    const naturelles = selectedCartes.filter(c => c.valeur !== 'Joker' && c.valeur !== '2');
    const deuxNonJoker = selectedCartes.filter(c => c.valeur === '2' && c.valeur !== 'Joker');
    
    let valeurCible = null;
    if (naturelles.length > 0) {
        valeurCible = naturelles[0].valeur;
    } else if (deuxNonJoker.length > 0) {
        valeurCible = '2';
    }
    
    const monEq = etatGlobal.monEquipe || 1;
    const maTable = etatGlobal.equipes[monEq].table || {};
    
    // Check if it matches an existing meld on our table
    if (valeurCible && maTable[valeurCible]) {
        // S'il y a déjà une canasta et qu'on a au moins 3 cartes, on peut démarrer un nouveau groupe
        if (maTable[valeurCible].estCanasta && cartesSelectionnees.size >= 3) {
            return { valide: true, type: 'nouveau' };
        }
        return { valide: true, type: 'ajout', valeur: valeurCible };
    }
    
    if (cartesSelectionnees.size >= 3) {
        return { valide: true, type: 'nouveau' };
    }
    
    return { valide: false };
}

let groupesPrepares = [];
let modeErreurPreparation = false;

document.getElementById('btn-poser').addEventListener('click', () => {
    const eval = evaluerSelection();
    if (!eval.valide) return;
    
    const arrayIds = Array.from(cartesSelectionnees);
    
    if (eval.type === 'ajout') {
        // Ajout direct sans préparation
        socket.emit('demandeDescendreCombinaison', [{ valeur: eval.valeur, cartesId: arrayIds }]);
        cartesSelectionnees.clear();
        sons.jouer('succes');
        return;
    }

    let grouped = autoGroupCartes(arrayIds);
    grouped = grouped.filter(g => g.cartesId.length >= 3);
    if (grouped.length === 0) {
        toast("Sélection invalide. 3 cartes minimum.", "error");
        sons.jouer('erreur');
        return;
    }
    
    // Récolter uniquement les IDs des groupes valides
    let validIds = new Set();
    grouped.forEach(g => g.cartesId.forEach(id => validIds.add(id)));

    // Déplacer les cartes vers la zone de préparation localement
    const cartesDeplacees = [];
    validIds.forEach(id => {
        const idx = etatGlobal.maMain.findIndex(c => c.id === id);
        if (idx !== -1) {
            cartesDeplacees.push(etatGlobal.maMain[idx]);
            etatGlobal.maMain.splice(idx, 1);
        }
    });
    
    grouped.forEach(g => {
        groupesPrepares.push({
            cartesId: g.cartesId,
            cartes: g.cartesId.map(id => cartesDeplacees.find(c => c.id === id)).filter(Boolean)
        });
    });
    
    cartesSelectionnees.clear();
    sons.jouer('select');
    rendreMelds(etatGlobal.equipes[etatGlobal.monEquipe], 'melds-equipe');
    rendreMain(etatGlobal.maMain); // Update hand visually
    mettreAJourBoutons();
});

document.getElementById('btn-valider-pose').addEventListener('click', () => {
    if (groupesPrepares.length === 0) return;
    const dataToSend = groupesPrepares.map(g => ({ cartesId: g.cartesId }));
    
    // Si le joueur n'a pas encore joué (ni pioché ni ramassé), c'est qu'il tente une ouverture sur la terre
    if (!etatGlobal.aJoueCeTour && etatGlobal.carteDessusDefausse) {
        socket.emit('demandeRamasserTerre', dataToSend);
    } else {
        socket.emit('demandeDescendreCombinaison', dataToSend);
    }
    
    verrouAction = true;
    setTimeout(() => verrouAction = false, 1000);
});

document.getElementById('btn-annuler-pose').addEventListener('click', () => {
    // Retourner les cartes dans la main
    groupesPrepares.forEach(g => {
        g.cartes.forEach(c => {
            // Ne pas remettre la carte de la terre dans la main
            if (etatGlobal.carteDessusDefausse && c.id === etatGlobal.carteDessusDefausse.id) return;
            
            if (!etatGlobal.maMain.find(existing => existing.id === c.id)) {
                etatGlobal.maMain.push(c);
            }
        });
    });
    groupesPrepares = [];
    modeErreurPreparation = false;
    rendreMelds(etatGlobal.equipes[etatGlobal.monEquipe], 'melds-equipe');
    rendreMain(etatGlobal.maMain);
    mettreAJourBoutons();
});

const btnRef = document.getElementById('btn-refresh'); if(btnRef) btnRef.addEventListener('click', () => {
    window.location.reload();
});
const btnSet = document.getElementById('btn-settings'); if(btnSet) btnSet.addEventListener('click', () => {
    toast("Paramètres à venir !", "info");
});

// Piocher en cliquant sur la pile
document.getElementById('pioche').addEventListener('click', () => {
    if (verrouAction || !etatGlobal || etatGlobal.tourActuel !== monNumero) return;
    verrouAction = true;
    socket.emit('demandePiocher');
    setTimeout(() => verrouAction = false, 1000);
});

// Ramasser terre en cliquant sur la terre
document.getElementById('terre').addEventListener('click', () => {
    if (verrouAction || !etatGlobal || etatGlobal.tourActuel !== monNumero) return;
    if (!etatGlobal.carteDessusDefausse) return;
    
    const aDejaTerre = groupesPrepares.some(g => g.cartesId.includes(etatGlobal.carteDessusDefausse.id));
    if (aDejaTerre) {
        toast("Vous avez déjà préparé la carte de la terre. Utilisez 'Poser' pour d'autres cartes.", "info");
        return;
    }

    const arrayIds = Array.from(cartesSelectionnees);
    
    if (arrayIds.length === 0) {
        toast("Sélectionnez 2 cartes de votre main pour préparer la prise de la terre.", "info");
        return;
    }

    let grouped = autoGroupCartes(arrayIds, etatGlobal.carteDessusDefausse);
    grouped = grouped.filter(g => g.cartesId.length >= 3);
    
    if (grouped.length === 0) {
        toast("Sélection invalide pour prendre la terre.", "error");
        sons.jouer('erreur');
        return;
    }

    // Récolter uniquement les IDs des groupes valides (excluant la terre pour ne pas la chercher dans la main)
    let validIds = new Set();
    grouped.forEach(g => g.cartesId.forEach(id => {
        if (id !== etatGlobal.carteDessusDefausse.id) validIds.add(id);
    }));

    // Déplacer les cartes vers la zone de préparation localement
    const cartesDeplacees = [];
    validIds.forEach(id => {
        const idx = etatGlobal.maMain.findIndex(c => c.id === id);
        if (idx !== -1) {
            cartesDeplacees.push(etatGlobal.maMain[idx]);
            etatGlobal.maMain.splice(idx, 1);
        }
    });

    // Ajouter la terre visuellement
    cartesDeplacees.push(etatGlobal.carteDessusDefausse);
    
    grouped.forEach(g => {
        groupesPrepares.push({
            cartesId: g.cartesId, 
            cartes: g.cartesId.map(id => cartesDeplacees.find(c => c.id === id)).filter(Boolean)
        });
    });
    
    cartesSelectionnees.clear();
    sons.jouer('select');
    rendreMelds(etatGlobal.equipes[etatGlobal.monEquipe], 'melds-equipe');
    rendreMain(etatGlobal.maMain);
    mettreAJourBoutons();
});

// =============================================================================
// RENDU DU JEU (PURE CSS)
// =============================================================================
function getCardClass(carte) {
    if (!carte) return 'back';
    if (carte.valeur === 'Joker') return 'joker';
    return (carte.couleur === 'Coeur' || carte.couleur === 'Carreau') ? 'red' : 'black';
}

function generateCardHTML(carte) {
    if (!carte) return '';
    if (carte.valeur === 'Joker') {
        return `
            <div class="idx tl"><span style="font-size:7px">JOK</span></div>
            <div class="pip">★</div>
            <div class="idx br"><span style="font-size:7px">JOK</span></div>
        `;
    }
    const suitSymbol = { 'Coeur': '♥', 'Carreau': '♦', 'Trefle': '♣', 'Pique': '♠' }[carte.couleur] || '';
    return `
        <div class="idx tl"><span>${carte.valeur}</span><span>${suitSymbol}</span></div>
        <div class="pip">${suitSymbol}</div>
        <div class="idx br"><span>${carte.valeur}</span><span>${suitSymbol}</span></div>
    `;
}

function mettreAJourBoutons() {
    const estMonTour = etatGlobal && etatGlobal.tourActuel === monNumero;
    const btnPoser = document.getElementById('btn-poser');
    const btnSortir = document.getElementById('btn-sortir');
    const btnValider = document.getElementById('btn-valider-pose');
    const btnAnnuler = document.getElementById('btn-annuler-pose');
    
    // Sortir Logic (only if eligible)
    const monEq = etatGlobal ? etatGlobal.equipes[etatGlobal.monEquipe] : null;
    let eligibleSortie = false;
    if (monEq && monEq.aOuvert) {
        let hasPure = false, hasImpure = false;
        Object.values(monEq.table).forEach(m => {
            if (m.estCanasta) {
                if (m.verrouilleePure) hasPure = true;
                else hasImpure = true;
            }
        });
        eligibleSortie = hasPure && hasImpure;
    }
    
    if (btnSortir) {
        if (estMonTour && eligibleSortie) {
            btnSortir.style.display = 'block';
            btnSortir.disabled = false;
        } else {
            btnSortir.style.display = 'none';
        }
    }

    if (groupesPrepares.length > 0) {
        if (btnPoser) btnPoser.style.display = 'none';
        if (btnValider) btnValider.style.display = modeErreurPreparation ? 'none' : 'flex';
        if (btnAnnuler) btnAnnuler.style.display = 'flex';
    } else {
        if (btnPoser) {
            btnPoser.style.display = 'block';
            if (estMonTour && typeof evaluerSelection === 'function' && evaluerSelection().valide) {
                btnPoser.disabled = false;
                btnPoser.style.transform = 'scale(1.1)';
            } else {
                btnPoser.disabled = true;
                btnPoser.style.transform = 'scale(1)';
            }
        }
        if (btnValider) btnValider.style.display = 'none';
        if (btnAnnuler) btnAnnuler.style.display = 'none';
    }
}



function onCarteTap(carte, element) {
    if (verrouAction) return;
    const now = Date.now();
    const last = dernierTap[carte.id] || 0;
    dernierTap[carte.id] = now;
    const estMonTour = etatGlobal && etatGlobal.tourActuel === monNumero;

    if (now - last < DOUBLE_TAP_MS && estMonTour) {
        // Double tap = Jeter la carte
        verrouAction = true;
        socket.emit('demandeJouerCarte', carte.id);
        sons.jouer('jeter');
        cartesSelectionnees.delete(carte.id);
        element.classList.remove('selectionnee');
        setTimeout(() => verrouAction = false, 1000);
        return;
    }

    if (cartesSelectionnees.has(carte.id)) {
        cartesSelectionnees.delete(carte.id);
        element.classList.remove('selectionnee');
    } else {
        cartesSelectionnees.add(carte.id);
        element.classList.add('selectionnee');
    }
    sons.jouer('select');
    mettreAJourBoutons();
}

// =============================================================================
// OVERLAP DYNAMIQUE — gère rangées multiples + gaps entre groupes
// =============================================================================
function applyDynamicOverlap() {
    const conteneur = document.getElementById('conteneur-main');
    if (conteneur.classList.contains('multi-row')) {
        const rows = conteneur.querySelectorAll('.main-row');
        rows.forEach(row => applyOverlapForRow(row));
    } else {
        applyOverlapForRow(conteneur);
    }
}

function applyOverlapForRow(row) {
    const cartes = row.querySelectorAll('.card');
    if (cartes.length === 0) return;
    if (cartes.length === 1) {
        cartes[0].style.marginLeft = '0';
        return;
    }

    const maxW = window.innerWidth - 225; const containerWidth = Math.min(row.clientWidth || maxW, maxW);
    const cardW = 68;
    const groupGap = 10;
    const groupStarts = row.querySelectorAll('.group-start').length;
    const totalGroupGap = groupStarts * groupGap;

    // Calculer l'overlap pour que tout rentre
    const availableWidth = containerWidth - totalGroupGap;
    let spacing = (availableWidth - cardW) / (cartes.length - 1);
    let overlap = spacing - cardW;

    if (overlap > -18) overlap = -18; // Pas trop écarté
    if (overlap < -50) overlap = -50; // Minimum lisible

    cartes.forEach((c, i) => {
        if (i === 0) {
            c.style.marginLeft = '0';
        } else if (c.classList.contains('group-start')) {
            c.style.marginLeft = `${overlap + groupGap}px`;
        } else {
            c.style.marginLeft = `${overlap}px`;
        }
    });
}

// =============================================================================
// RENDU DE LA MAIN — tri intelligent + multi-rangées + wildcards déplaçables
// =============================================================================
let sortableHand = null;

function rendreMain(mainCartes) {
    const conteneur = document.getElementById('conteneur-main');
    conteneur.innerHTML = '';
    if (sortableHand) { sortableHand.destroy(); sortableHand = null; }

    if (!mainCartes || mainCartes.length === 0) return;

    const groupes = trierMainIntelligent(mainCartes);
    const totalCartes = mainCartes.length;
    const useMultiRow = false;

    // Carte data lookup pour les wildcards déplacés
    const carteParId = new Map();
    mainCartes.forEach(c => carteParId.set(c.id, c));

    function creerElementCarte(c, isWildcard) {
        const el = document.createElement('div');
        el.className = `card ${getCardClass(c)}`;
        el.dataset.id = c.id;
        if (isWildcard) el.classList.add('wildcard-draggable');
        if (cartesSelectionnees.has(c.id)) el.classList.add('selectionnee');
        el.innerHTML = generateCardHTML(c);
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            onCarteTap(c, el);
        });
        return el;
    }

    if (useMultiRow) {
        conteneur.classList.add('multi-row');
        const row1 = document.createElement('div');
        row1.className = 'main-row';
        const row2 = document.createElement('div');
        row2.className = 'main-row';

        // Répartir les groupes entre les 2 rangées de façon équilibrée
        let count1 = 0, count2 = 0;
        groupes.forEach(groupe => {
            const isWild = groupe.type === 'wildcards';
            const targetRow = count1 <= count2 ? row1 : row2;
            const isNewGroupInRow = targetRow.children.length > 0;

            groupe.cartes.forEach((c, i) => {
                const el = creerElementCarte(c, isWild);
                if (i === 0 && isNewGroupInRow) el.classList.add('group-start');
                targetRow.appendChild(el);
            });

            if (count1 <= count2) count1 += groupe.cartes.length;
            else count2 += groupe.cartes.length;
        });

        conteneur.appendChild(row1);
        conteneur.appendChild(row2);

        // SortableJS sur chaque rangée — seuls les wildcards sont déplaçables
        [row1, row2].forEach(row => {
            new Sortable(row, {
                animation: 200,
                delay: 200,
                delayOnTouchOnly: true,
                direction: 'horizontal',
                draggable: '.wildcard-draggable',
                group: 'hand',
                ghostClass: 'sortable-ghost',
                onEnd: () => {
                    requestAnimationFrame(() => {
                        applyDynamicOverlap();
                    });
                }
            });
        });
    } else {
        conteneur.classList.remove('multi-row');
        let isFirstGroup = true;

        groupes.forEach(groupe => {
            const isWild = groupe.type === 'wildcards';
            groupe.cartes.forEach((c, i) => {
                const el = creerElementCarte(c, isWild);
                if (i === 0 && !isFirstGroup) el.classList.add('group-start');
                conteneur.appendChild(el);
            });
            isFirstGroup = false;
        });

        // SortableJS — seuls les wildcards sont déplaçables
        sortableHand = new Sortable(conteneur, {
            animation: 200,
            delay: 200,
            delayOnTouchOnly: true,
            direction: 'horizontal',
            draggable: '.wildcard-draggable',
            ghostClass: 'sortable-ghost',
            onEnd: () => {
                requestAnimationFrame(() => {
                    applyDynamicOverlap();
                });
            }
        });
    }

    // Appliquer l'overlap après un petit délai pour que le DOM soit prêt
    requestAnimationFrame(() => applyDynamicOverlap());
}

// Fonction utilitaire pour calculer le total des points d'un meld
function totalPointsMeld(cartes) {
    return cartes.reduce((total, c) => total + c.points, 0);
}

function rendreMelds(equipeData, conteneurId) {
    const conteneur = document.getElementById(conteneurId);
    if (!conteneur) return;
    
    // Réinitialiser le titre
    const labelText = conteneurId === 'melds-equipe' ? 'Descente Nous' : 'Descente Eux';
    conteneur.innerHTML = `<div class="meld-label">${labelText}</div>`;
    
    if (!equipeData) return;

    if (equipeData.troisRouges && equipeData.troisRouges.length > 0) {
        const bonus = document.createElement('span');
        bonus.className = 'bonus-chip';
        bonus.style.display = 'inline-block';
        bonus.style.marginLeft = '8px';
        bonus.style.padding = '2px 5px';
        bonus.style.fontSize = '8px';
        bonus.textContent = `♦ 3 rouge × ${equipeData.troisRouges.length}`;
        const currentTitle = conteneur.querySelector('.meld-label');
        if (currentTitle) currentTitle.appendChild(bonus);
    }

    const valeursTriees = Object.keys(equipeData.table).sort((a,b) => a - b);
    valeursTriees.forEach(val => {
        const combi = equipeData.table[val];
        const canastaDiv = document.createElement('div');
        
        // Déterminer la classe de la canasta
        let typeCanasta = 'open';
        let isPure = false;
        if (combi.cartes.length >= 7) {
            isPure = !combi.cartes.some(c => c.valeur === 'Joker' || c.valeur === '2');
            typeCanasta = 'closed ' + (isPure ? 'pure' : 'mixed');
        }
        
        canastaDiv.className = `canasta ${typeCanasta}`;
        
        const slotsDiv = document.createElement('div');
        slotsDiv.className = 'slots';
        
        if (combi.cartes.length >= 7) {
            const slot = document.createElement('div');
            const c = combi.cartes.find(x => x.valeur !== 'Joker' && x.valeur !== '2') || combi.cartes[0];
            const color = (c.couleur === 'Coeur' || c.couleur === 'Carreau') ? ' red' : '';
            const valDisplay = (c.valeur === 'Joker' || c.valeur === '2') ? '★' : (c.valeur === '10' ? '10' : c.valeur[0]);
            slot.className = `slot filled${color}`;
            slot.textContent = valDisplay;
            slot.style.width = '30px';
            slot.style.boxShadow = '2px 2px 5px rgba(0,0,0,0.5)';
            slotsDiv.appendChild(slot);
        } else {
            for (let i = 0; i < 7; i++) {
                const slot = document.createElement('div');
                if (i < combi.cartes.length) {
                    const c = combi.cartes[i];
                    const color = (c.couleur === 'Coeur' || c.couleur === 'Carreau') ? ' red' : '';
                    const valDisplay = (c.valeur === 'Joker' || c.valeur === '2') ? '★' : (c.valeur === '10' ? '10' : c.valeur[0]);
                    slot.className = `slot filled${color}`;
                    slot.textContent = valDisplay;
                } else {
                    slot.className = 'slot';
                }
                slotsDiv.appendChild(slot);
            }
        }
        canastaDiv.appendChild(slotsDiv);
        
        // Afficher le tag
        const tag = document.createElement('span');
        tag.className = `canasta-tag ${combi.cartes.length >= 7 ? (isPure ? 'pure' : 'mixed') : 'open'}`;
        
        if (combi.cartes.length >= 7) {
            tag.innerHTML = isPure ? `<svg class="icon"><use href="#i-star"/></svg>7/7 pure` : `<svg class="icon"><use href="#i-star"/></svg>7/7 mixte`;
        } else {
            tag.textContent = `${combi.cartes.length}/7`;
        }
        canastaDiv.appendChild(tag);
        
        canastaDiv.addEventListener('click', () => {
            const estMonTour = etatGlobal && etatGlobal.tourActuel === monNumero;
            const isMonEquipe = conteneurId === 'melds-equipe';
            if (estMonTour && isMonEquipe && cartesSelectionnees.size > 0) {
                socket.emit('demandeDescendreCombinaison', [{
                    valeur: val,
                    cartesId: Array.from(cartesSelectionnees)
                }]);
                cartesSelectionnees.clear();
                sons.jouer('succes');
            }
        });
        
        conteneur.appendChild(canastaDiv);
    });
    // Ajouter la zone de préparation à la suite
    if (conteneurId === 'melds-equipe' && typeof groupesPrepares !== 'undefined' && groupesPrepares.length > 0) {
        groupesPrepares.forEach(g => {
            const canastaDiv = document.createElement('div');
            canastaDiv.className = 'canasta open staged';
            canastaDiv.style.border = '1px dashed #fff';
            
            const slotsDiv = document.createElement('div');
            slotsDiv.className = 'slots';
            
            g.cartes.forEach(c => {
                const slot = document.createElement('div');
                const color = (c.couleur === 'Coeur' || c.couleur === 'Carreau') ? ' red' : '';
                const valDisplay = (c.valeur === 'Joker' || c.valeur === '2') ? '★' : (c.valeur === '10' ? '10' : c.valeur[0]);
                slot.className = `slot filled${color}`;
                slot.textContent = valDisplay;
                slotsDiv.appendChild(slot);
            });
            // fill remaining up to 7
            for(let i=g.cartes.length; i<7; i++) {
                const slot = document.createElement('div');
                slot.className = 'slot';
                slotsDiv.appendChild(slot);
            }
            canastaDiv.appendChild(slotsDiv);
            
            const tag = document.createElement('span');
            tag.className = 'canasta-tag open';
            tag.textContent = 'Pose';
            canastaDiv.appendChild(tag);
            
            conteneur.appendChild(canastaDiv);
        });
    }

    // Plus ghost
    const ghost = document.createElement('div');
    ghost.className = 'meld-ghost';
    ghost.textContent = '+';
    conteneur.appendChild(ghost);
}

function rendreAdversaires(etat) {
    if (!etat.monNumero || estSpectateur) return;
    const moi = etat.monNumero;
    const partenaire = ((moi + 2 - 1) % 4) + 1;
    const gauche = (moi % 4) + 1;
    const droite = ((moi + 2) % 4) + 1;

    function dessinerPaquet(id, numJoueur) {
        const el = document.getElementById(id);
        if (!el) return;
        
        const nbCartes = etat.tailleMains[numJoueur] || 0;
        const iconId = id === 'adv-haut' ? '#i-person' : '#i-bot';
        const name = id === 'adv-haut' ? 'Partenaire' : (id === 'adv-gauche' ? 'Bot 1' : 'Bot 2');
        
        let handFanHTML = '';
        const limit = Math.min(nbCartes, 7);
        for(let i=0; i<limit; i++) {
            if (id === 'adv-haut') {
                const angle = -10 + (i * 20/limit);
                handFanHTML += `<div class="mini-back" style="left:${i*8}px; transform:rotate(${angle}deg);"></div>`;
            } else {
                handFanHTML += `<div class="mini-back" style="top:${i*6}px;"></div>`;
            }
        }

        el.innerHTML = `
          <div class="hand-fan" ${id === 'adv-haut' ? `style="width:${(limit-1)*8 + 13}px;"` : `style="height:${(limit-1)*6 + 18}px;"`}>
            ${handFanHTML}
          </div>
          <div class="avatar-wrap">
            <div class="avatar"><svg class="icon"><use href="${iconId}"/></svg></div>
            <span class="card-count">${nbCartes}</span>
          </div>
          <div class="avatar-name">${name}</div>
          
        `;
    }

    dessinerPaquet('adv-haut', partenaire);
    dessinerPaquet('adv-gauche', gauche);
    dessinerPaquet('adv-droite', droite);
}

function rendreScoresEtTour(etat) {
    const monEq = etat.monEquipe || 1;
    const autreEq = monEq === 1 ? 2 : 1;

    const dataMonEq = etat.equipes[monEq] || { score: 0 };
    const dataAutreEq = etat.equipes[autreEq] || { score: 0 };

    // Update Progress Bars (max 15000)
    const pctEquipe = Math.max(0, Math.min(100, (dataMonEq.score / 15000) * 100));
    const pctAdversaire = Math.max(0, Math.min(100, (dataAutreEq.score / 15000) * 100));

    const pEq = document.getElementById('progression-eq'); if(pEq) pEq.style.width = pctEquipe + '%';
    document.getElementById('score-equipe-text').textContent = dataMonEq.score;

    const pAdv = document.getElementById('progression-adv'); if(pAdv) pAdv.style.width = pctAdversaire + '%';
    document.getElementById('score-adverse-text').textContent = dataAutreEq.score;

    // Tour indicator
    const indic = document.getElementById('indicateur-tour');
    if (etat.tourActuel === monNumero) {
        indic.textContent = "À VOUS DE JOUER !";
        indic.style.color = "var(--gold)";
        indic.style.borderColor = "var(--gold)";
    } else {
        const mapNoms = {};
        const partenaire = ((monNumero + 2 - 1) % 4) + 1;
        const gauche = (monNumero % 4) + 1;
        const droite = ((monNumero + 2) % 4) + 1;
        mapNoms[partenaire] = "Partenaire";
        mapNoms[gauche] = "Adv. Gauche";
        mapNoms[droite] = "Adv. Droite";

        indic.textContent = "Tour : " + (mapNoms[etat.tourActuel] || `Joueur ${etat.tourActuel}`);
        indic.style.color = "#fff";
        indic.style.borderColor = "rgba(255,255,255,0.2)";
    }
}

function rendrePioche(taille) {
    const pioche = document.getElementById('pioche');
    if (!pioche) return;
    
    pioche.innerHTML = `
        <div class="draw-layer" style="opacity:${taille > 2 ? 0.55 : 0}"></div>
        <div class="draw-layer" style="opacity:${taille > 1 ? 0.8 : 0}"></div>
        <div class="draw-layer" style="opacity:${taille > 0 ? 1 : 0.2}"></div>
        ${taille > 0 ? `<span class="pile-count">${taille} rest.</span>` : ''}
    `;
}

function rendreDefausse(carteDessus, taille) {
    const terre = document.getElementById('terre');
    if (!terre) return;
    terre.innerHTML = '';
    
    if (carteDessus) {
        let suitSymbol = { 'Coeur': '♥', 'Carreau': '♦', 'Trefle': '♣', 'Pique': '♠' }[carteDessus.couleur] || '';
        let val = carteDessus.valeur === 'Joker' ? '★' : carteDessus.valeur;
        let isGel = etatGlobal && etatGlobal.terreGelee;
        let colorClass = (carteDessus.couleur === 'Coeur' || carteDessus.couleur === 'Carreau') ? 'color:var(--red);' : 'color:#151515;';
        
        terre.innerHTML = `
            <span style="${colorClass}">${val}</span>
            <span style="${colorClass}">${suitSymbol}</span>
            ${isGel ? `<span class="frozen-badge"><svg class="icon"><use href="#i-lock"/></svg>Gelée</span>` : ''}
        `;
    } else {
        terre.innerHTML = '';
        terre.style.background = 'transparent';
        terre.style.border = '1px dashed rgba(255,255,255,0.3)';
    }

    if (taille > 0) {
        terre.innerHTML += `<div class="badge-terre">${taille}</div>`;
    }
}

// =============================================================================
// BOUCLE PRINCIPALE SOCKET.IO
// =============================================================================
socket.on('miseAJourEtat', (etat) => {
    etatGlobal = etat;
    if (etat.enJeu && ecranActuel !== 'jeu') {
        afficherEcran('jeu');
        cartesSelectionnees.clear();
    }
    if (etat.monNumero) monNumero = etat.monNumero;

    if (!modeErreurPreparation) {
        groupesPrepares = [];
    }

    if (etat.maMain) rendreMain(etat.maMain);

    const monEq = etat.monEquipe || 1;
    const autreEq = monEq === 1 ? 2 : 1;

    if (etat.equipes) {
        // Render melds matching the Canasta layout
        rendreMelds(etat.equipes[monEq], 'melds-equipe');
        rendreMelds(etat.equipes[autreEq], 'melds-adversaire');
        rendreScoresEtTour(etat);
    }

    rendrePioche(etat.taillePioche);
    rendreDefausse(etat.carteDessusDefausse, etat.tailleDefausse);
    if (etat.tailleMains) rendreAdversaires(etat);
    mettreAJourBoutons();

    // Check for recap
    if (etat.dernierRecapManche && !etat.enJeu && !etat.partieTerminee) {
        afficherRecap(etat.dernierRecapManche);
    }
    
    if (etat.partieTerminee) {
        afficherVictoire(etat.vainqueur, etat.equipes);
    }
});

// Modals
function afficherRecap(recap) {
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('modal-scores').style.display = 'block';
    
    let html = '';
    for (let eq of [1, 2]) {
        let d = recap.equipes[eq];
        if (!d) continue;
        html += `<h3 style="color:${eq===etatGlobal.monEquipe?'#3498db':'#e74c3c'}">${eq===etatGlobal.monEquipe?'Notre Équipe':'Adversaires'}</h3>`;
        html += `<div class="ligne-score"><span>3 Rouges :</span><span>${d.detail.troisRouges}</span></div>`;
        html += `<div class="ligne-score"><span>Posé :</span><span>${d.detail.valeurCombinaisons}</span></div>`;
        
        let pures = d.detail.canastas.filter(c=>c.pure).reduce((s,c)=>s+c.points,0);
        let impures = d.detail.canastas.filter(c=>!c.pure).reduce((s,c)=>s+c.points,0);
        html += `<div class="ligne-score"><span>Canastas Pures :</span><span>${pures}</span></div>`;
        html += `<div class="ligne-score"><span>Canastas Impures :</span><span>${impures}</span></div>`;
        
        if (d.detail.bonusSortie) {
            html += `<div class="ligne-score" style="color:var(--gold)"><span>Sortie :</span><span>${d.detail.bonusSortie}</span></div>`;
        }
        html += `<div class="ligne-score" style="color:var(--red)"><span>Main restante :</span><span>-${d.detail.valeurMainRestante}</span></div>`;
        html += `<div class="ligne-score"><span>TOTAL MANCHE :</span><span>${d.pointsManche}</span></div>`;
        html += `<div class="ligne-score" style="color:var(--gold)"><span>SCORE GLOBAL :</span><span>${d.scoreTotal}</span></div>`;
    }
    document.getElementById('contenu-scores').innerHTML = html;
}

document.getElementById('btn-fermer-scores').addEventListener('click', () => {
    document.getElementById('modal-scores').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'none';
});

function afficherVictoire(vainqueur, equipes) {
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('modal-victoire').style.display = 'block';
    sons.jouer('victoire');
    
    const txt = document.getElementById('texte-victoire');
    if (vainqueur === etatGlobal.monEquipe) {
        txt.innerHTML = `Félicitations ! Votre équipe a gagné avec ${equipes[vainqueur].score} points !`;
        txt.style.color = "var(--green)";
    } else {
        txt.innerHTML = `Dommage... L'équipe adverse gagne avec ${equipes[vainqueur].score} points.`;
        txt.style.color = "var(--red)";
    }
}

document.getElementById('btn-retour-lobby').addEventListener('click', () => {
    document.getElementById('modal-victoire').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'none';
    socket.emit('quitterSalon');
    afficherEcran('lobby');
});

socket.on('questionSortie', () => {
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('modal-sortie').style.display = 'block';
    sons.jouer('carte');
});

document.getElementById('btn-accepter-sortie').addEventListener('click', () => {
    socket.emit('reponseSortie', true);
    document.getElementById('modal-sortie').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'none';
});

document.getElementById('btn-refuser-sortie').addEventListener('click', () => {
    socket.emit('reponseSortie', false);
    document.getElementById('modal-sortie').style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'none';
});

socket.on('resultatSortie', (data) => {
    if (data.accepte || data === true) {
        toast("Votre allié accepte ! Vous pouvez sortir.", "success");
    } else {
        toast("Votre allié a refusé que vous sortiez.", "error");
    }
});