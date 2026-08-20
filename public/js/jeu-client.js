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
document.getElementById('btn-emoji').addEventListener('click', () => {
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
        if (c.estJoker || c.valeur === '2') wildcards.push(c);
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
    
    const naturelles = selectedCartes.filter(c => !c.estJoker && c.valeur !== '2');
    const deuxNonJoker = selectedCartes.filter(c => c.valeur === '2' && !c.estJoker);
    
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

document.getElementById('btn-refresh').addEventListener('click', () => {
    window.location.reload();
});
document.getElementById('btn-settings').addEventListener('click', () => {
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
            <div class="card-corner top-left"><div class="card-val" style="font-size:10px">JOKER</div></div>
            <div class="card-center">🃏</div>
            <div class="card-corner bottom-right"><div class="card-val" style="font-size:10px">JOKER</div></div>
        `;
    }
    const suitSymbol = { 'Coeur': '♥', 'Carreau': '♦', 'Trefle': '♣', 'Pique': '♠' }[carte.couleur] || '';
    return `
        <div class="card-corner top-left"><div class="card-val">${carte.valeur}</div><div class="card-suit" style="color:inherit">${suitSymbol}</div></div>
        <div class="card-center" style="color:inherit">${suitSymbol}</div>
        <div class="card-corner bottom-right"><div class="card-val">${carte.valeur}</div><div class="card-suit" style="color:inherit">${suitSymbol}</div></div>
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
        if (btnValider) btnValider.style.display = modeErreurPreparation ? 'none' : 'block';
        if (btnAnnuler) btnAnnuler.style.display = 'block';

        let scorePose = 0;
        groupesPrepares.forEach(g => {
            g.cartes.forEach(c => scorePose += c.points);
        });
        
        const ind = document.getElementById('indicateur-score-pose');
        if (ind) {
            ind.style.display = 'block';
            let targetScore = 60;
            if (etatGlobal) {
                const eq = etatGlobal.equipes[etatGlobal.monEquipe];
                if (eq && !eq.aOuvert) targetScore = eq.seuilOuverture || 60;
                else targetScore = 0;
            }
            if (targetScore > 0) {
                ind.textContent = `Score : ${scorePose} / ${targetScore}`;
                ind.style.color = scorePose >= targetScore ? '#4ade80' : '#f87171';
            } else {
                ind.textContent = `Score : ${scorePose}`;
                ind.style.color = '#fff';
            }
        }
    } else {
        const ind = document.getElementById('indicateur-score-pose');
        if (ind) ind.style.display = 'none';

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
    const cartes = row.querySelectorAll('.carte-main');
    if (cartes.length === 0) return;
    if (cartes.length === 1) {
        cartes[0].style.marginLeft = '0';
        return;
    }

    const containerWidth = row.clientWidth || window.innerWidth - 20;
    const cardW = 55;
    const groupGap = 10;
    const groupStarts = row.querySelectorAll('.group-start').length;
    const totalGroupGap = groupStarts * groupGap;

    // Calculer l'overlap pour que tout rentre
    const availableWidth = containerWidth - totalGroupGap;
    let spacing = (availableWidth - cardW) / (cartes.length - 1);
    let overlap = spacing - cardW;

    if (overlap > -18) overlap = -18; // Pas trop écarté
    if (overlap < -42) overlap = -42; // Minimum lisible

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
    const useMultiRow = totalCartes > 16;

    // Carte data lookup pour les wildcards déplacés
    const carteParId = new Map();
    mainCartes.forEach(c => carteParId.set(c.id, c));

    function creerElementCarte(c, isWildcard) {
        const el = document.createElement('div');
        el.className = `carte-main pure-css-card ${getCardClass(c)}`;
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
    conteneur.innerHTML = '';
    if (!equipeData) return;

    // Rendre les 3 rouges en premier comme une colonne standard
    if (equipeData.troisRouges && equipeData.troisRouges.length > 0) {
        const col = document.createElement('div');
        col.className = 'colonne-meld';
        
        equipeData.troisRouges.forEach((c, index) => {
            const el = document.createElement('div');
            el.className = `carte-meld pure-css-card ${getCardClass(c)}`;
            el.innerHTML = generateCardHTML(c);
            
            // Ajouter le badge de points uniquement sur la dernière carte (la plus en bas visible)
            if (index === equipeData.troisRouges.length - 1) {
                const badge = document.createElement('div');
                badge.className = 'badge-points-meld';
                badge.textContent = totalPointsMeld(equipeData.troisRouges);
                el.appendChild(badge);
            }
            col.appendChild(el);
        });
        conteneur.appendChild(col);
    }

    // Rendre les autres melds
    const valeursTriees = Object.keys(equipeData.table).sort((a,b) => a - b);
    valeursTriees.forEach(val => {
        const combi = equipeData.table[val];
        const col = document.createElement('div');
        col.className = 'colonne-meld';
        
        // Allow clicking meld to add selected cards to it
        col.addEventListener('click', () => {
            const estMonTour = etatGlobal && etatGlobal.tourActuel === monNumero;
            const monEq = etatGlobal.monEquipe || 1;
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

        const pointsMeld = totalPointsMeld(combi.cartes);
        
        // --- Professional Canasta Collapse Logic ---
        if (combi.cartes.length >= 7) {
            // It's a Canasta! Collapse it to save space.
            const aUnJoker = combi.cartes.some(c => c.valeur === 'Joker' || c.valeur === '2');
            const classeCouleur = aUnJoker ? 'canasta-noire' : 'canasta-rouge';
            const naturalCard = combi.cartes.find(c => c.valeur !== 'Joker' && c.valeur !== '2') || combi.cartes[0];
            
            const el = document.createElement('div');
            el.className = `carte-meld canasta-collapsed ${classeCouleur} pure-css-card ${getCardClass(naturalCard)}`;
            el.innerHTML = generateCardHTML(naturalCard);
            
            // Add point badge
            const badgePts = document.createElement('div');
            badgePts.className = 'badge-points-meld';
            badgePts.textContent = pointsMeld;
            el.appendChild(badgePts);
            
            // Add count badge
            const badgeCount = document.createElement('div');
            badgeCount.className = 'badge-count-meld';
            badgeCount.textContent = `x${combi.cartes.length}`;
            el.appendChild(badgeCount);
            
            col.appendChild(el);
            
        } else {
            // Normal meld rendering (< 7 cards)
            combi.cartes.forEach((c, index) => {
                const el = document.createElement('div');
                el.className = `carte-meld pure-css-card ${getCardClass(c)}`;
                el.innerHTML = generateCardHTML(c);
                
                // Effet visuel si canasta pure ou impure
                if (combi.estCanasta) {
                    if (combi.verrouilleePure) el.style.border = '2px solid var(--red)';
                    else el.style.border = '2px solid #000';
                }

                // Ajouter le badge de points uniquement sur la dernière carte
                if (index === combi.cartes.length - 1) {
                    const badge = document.createElement('div');
                    badge.className = 'badge-points-meld';
                    badge.textContent = pointsMeld;
                    el.appendChild(badge);
                }

                col.appendChild(el);
            });
        }
        conteneur.appendChild(col);
    });

    // Ajouter la zone de préparation à la suite
    if (conteneurId === 'melds-equipe' && groupesPrepares.length > 0) {
        groupesPrepares.forEach(g => {
            const col = document.createElement('div');
            col.className = 'colonne-meld staged';
            g.cartes.forEach((c) => {
                const el = document.createElement('div');
                el.className = `carte-meld pure-css-card ${getCardClass(c)}`;
                el.innerHTML = generateCardHTML(c);
                col.appendChild(el);
            });
            conteneur.appendChild(col);
        });
    }
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
        el.innerHTML = '';
        const nbCartes = etat.tailleMains[numJoueur] || 0;
        for (let i = 0; i < Math.min(nbCartes, 15); i++) {
            const carteBack = document.createElement('div');
            carteBack.className = 'pure-css-card back';
            el.appendChild(carteBack);
        }
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

    document.getElementById('progression-eq').style.width = pctEquipe + '%';
    document.getElementById('score-equipe-text').textContent = dataMonEq.score;

    document.getElementById('progression-adv').style.width = pctAdversaire + '%';
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
    pioche.innerHTML = `<div class="pure-css-card back" style="width:100%;height:100%;opacity:${taille > 0 ? 1 : 0.2}"></div>`;
    if (taille > 0) {
        pioche.innerHTML += `<div class="badge-pioche">${taille}</div>`;
    }
}

function rendreDefausse(carteDessus, taille) {
    const terre = document.getElementById('terre');
    terre.innerHTML = '';
    
    if (carteDessus) {
        const el = document.createElement('div');
        el.className = `pure-css-card ${getCardClass(carteDessus)}`;
        el.style.width = '100%'; el.style.height = '100%';
        el.innerHTML = generateCardHTML(carteDessus);
        terre.appendChild(el);
    } else {
        const vide = document.createElement('div');
        vide.style.width = '100%'; vide.style.height = '100%'; vide.style.borderRadius = 'var(--card-r)';
        vide.style.border = '1px dashed rgba(255,255,255,0.3)';
        terre.appendChild(vide);
    }

    if (taille > 0) {
        const badge = document.createElement('div');
        badge.className = 'badge-terre';
        badge.textContent = taille;
        terre.appendChild(badge);
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
// =============================================================================
// RECONNEXION ET ANTI-FREEZE MOBILE
// =============================================================================
socket.on('connect', () => {
    const oldId = sessionStorage.getItem('canastaSocketId');
    if (oldId && oldId !== socket.id) {
        socket.emit('tentativeReconnexion', oldId);
    }
    sessionStorage.setItem('canastaSocketId', socket.id);
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (!socket.connected) {
            socket.connect();
        } else if (ecranActuel === 'jeu') {
            socket.emit('demandeRafraichissement');
        }
    }
});

