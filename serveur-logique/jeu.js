// ============================================================================
// MOTEUR DE RÈGLES — CANASTA LIBANAISE
// ============================================================================
// Ce fichier contient toute la logique du jeu, indépendante du réseau.
// Il ne connaît rien à Socket.io : il expose des méthodes qui retournent soit
// un résultat de succès, soit une erreur lisible, à charge du serveur de les
// relayer aux bons joueurs.
// ============================================================================

let prochainIdCarte = 1;

function calculerPointsCarte(couleur, valeur) {
    if (valeur === 'Joker') return 50;
    if (valeur === '2') return 25;
    if (valeur === 'A') return 20;
    if (['8', '9', '10', 'V', 'D', 'R'].includes(valeur)) return 10;
    if (['4', '5', '6', '7'].includes(valeur)) return 5;
    if (valeur === '3') {
        return (couleur === 'Coeur' || couleur === 'Carreau') ? 100 : 0;
    }
    return 0;
}

class Carte {
    constructor(couleur, valeur) {
        this.id = `c${prochainIdCarte++}`;
        this.couleur = couleur;
        this.valeur = valeur;
        this.points = calculerPointsCarte(couleur, valeur);
        this.estJoker = valeur === 'Joker';
        this.est3Rouge = valeur === '3' && (couleur === 'Coeur' || couleur === 'Carreau');
        this.est3Noir = valeur === '3' && (couleur === 'Trefle' || couleur === 'Pique');
        // "Wildcard" au sens large (utilisable pour compléter une combinaison qui n'est pas elle-même en 2)
        this.estWildcardGenerique = this.estJoker || valeur === '2';
    }
}

// Vue publique d'une carte : tout ce qu'on a le droit d'envoyer à un joueur
// qui n'est pas censé la connaître en détail (on n'en a pas besoin ici car
// on ne cache jamais rien d'autre que "combien de cartes" pour les mains
// adverses, mais on garde la fonction pour un usage futur / clarté).
function serialiserCarte(carte) {
    return { id: carte.id, couleur: carte.couleur, valeur: carte.valeur, points: carte.points };
}

class PartieCanasta {
    constructor() {
        this.reinitialiserPartieComplete();
    }

    // =========================================================================
    // CYCLE DE VIE : PARTIE / MANCHE
    // =========================================================================

    reinitialiserPartieComplete() {
        this.enJeu = false;
        this.partieTerminee = false;
        this.vainqueur = null; // 1 | 2 | null

        this.equipes = {
            1: { membres: [1, 3], score: 0, aOuvert: false, table: {}, troisRouges: [] },
            2: { membres: [2, 4], score: 0, aOuvert: false, table: {}, troisRouges: [] }
        };

        this.joueurs = {
            1: { main: [] }, 2: { main: [] }, 3: { main: [] }, 4: { main: [] }
        };

        this.sortieRefusee = {};

        this.pioche = [];
        this.defausse = [];
        this.tourActuel = 1;
        this.aJoueCeTour = false; // a pioché OU ramassé la terre
        this.dernierGagnantManche = null;
        this.dernierRecapManche = null;
    }

    demarrerNouvellePartie() {
        this.reinitialiserPartieComplete();
        this.enJeu = true;
        this.demarrerNouvelleManche(1);
    }

    // Redémarre une manche : nouveau paquet, nouvelle distribution, tables vides.
    // Les scores cumulés des équipes (this.equipes[x].score) sont conservés.
    demarrerNouvelleManche(premierJoueur) {
        this.pioche = [];
        this.defausse = [];
        this.aJoueCeTour = false;
        this.dernierRecapManche = null;
        this.sortieRefusee = {};

        for (const numEquipe of [1, 2]) {
            this.equipes[numEquipe].aOuvert = false;
            this.equipes[numEquipe].table = {};
            this.equipes[numEquipe].troisRouges = [];
        }

        this.initialiserPaquet();
        this.melangerPioche();
        this.distribuerCartes();

        this.tourActuel = premierJoueur || 1;
    }

    initialiserPaquet() {
        const couleurs = ['Coeur', 'Carreau', 'Trefle', 'Pique'];
        const valeurs = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];

        for (let jeu = 0; jeu < 3; jeu++) {
            for (const c of couleurs) {
                for (const v of valeurs) {
                    this.pioche.push(new Carte(c, v));
                }
            }
            this.pioche.push(new Carte('Joker', 'Joker'));
            this.pioche.push(new Carte('Joker', 'Joker'));
        }
    }

    melangerPioche() {
        for (let i = this.pioche.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.pioche[i], this.pioche[j]] = [this.pioche[j], this.pioche[i]];
        }
    }

    distribuerCartes() {
        for (let i = 1; i <= 4; i++) {
            this.joueurs[i].main = [];
            this.joueurs[i].aPerduDroitOuverture = false;
            this.joueurs[i].aFaitFauxDepart = false;
        }
        for (let i = 1; i <= 4; i++) {
            for (let c = 0; c < 15; c++) {
                if (this.pioche.length > 0) {
                    this.joueurs[i].main.push(this.pioche.pop());
                }
            }
        }
        // Exposition automatique des 3 rouges présents dès la donne initiale
        for (let i = 1; i <= 4; i++) {
            this.gererCartesEntranteMain(i, []);
        }
    }

    equipeDuJoueur(numJoueur) {
        return (numJoueur === 1 || numJoueur === 3) ? 1 : 2;
    }

    // =========================================================================
    // GESTION DES 3 ROUGES : exposition + remplacement immédiat depuis la pioche
    // =========================================================================
    // `nouvellesCartes` sert uniquement de trace pour le retour d'info ; la
    // fonction agit toujours sur l'intégralité de this.joueurs[j].main.
    gererCartesEntranteMain(numJoueur) {
        const joueur = this.joueurs[numJoueur];
        const numEquipe = this.equipeDuJoueur(numJoueur);
        const troisRougesExposes = [];

        let continuer = true;
        while (continuer) {
            continuer = false;
            for (let i = joueur.main.length - 1; i >= 0; i--) {
                if (joueur.main[i].est3Rouge) {
                    const carte = joueur.main.splice(i, 1)[0];
                    this.equipes[numEquipe].troisRouges.push(carte);
                    troisRougesExposes.push(carte);

                    if (this.pioche.length > 0) {
                        const remplacement = this.pioche.pop();
                        joueur.main.push(remplacement);
                        if (remplacement.est3Rouge) continuer = true;
                    }
                }
            }
        }
        return troisRougesExposes;
    }

    peutSortir(numEquipe) {
        let aPure = false;
        let aImpure = false;
        const table = this.equipes[numEquipe].table;
        for (const val in table) {
            const combo = table[val];
            if (combo.cartes.length >= 7) {
                const estPure = combo.cartes.every(c => !c.estJoker && (combo.valeur === '2' || c.valeur !== '2'));
                if (estPure) aPure = true;
                else aImpure = true;
            }
        }
        return aPure && aImpure;
    }

    demanderSortie(numJoueur) {
        const numEquipe = this.equipeDuJoueur(numJoueur);
        const equipe = this.equipes[numEquipe];
        return equipe.membres.find(m => m !== numJoueur);
    }

    // =========================================================================
    // TOUR DE JEU — ÉTAPE 1a : PIOCHER (2 CARTES)
    // =========================================================================
    _recyclerDefausseSiBesoin(nbNecessaires) {
        if (this.pioche.length < nbNecessaires) {
            if (this.pioche.length + this.defausse.length < nbNecessaires) {
                return false; // Pas assez de cartes même avec la défausse
            }

            const nouvellesCartes = this.defausse.slice();
            // Mélanger la défausse
            for (let i = nouvellesCartes.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [nouvellesCartes[i], nouvellesCartes[j]] = [nouvellesCartes[j], nouvellesCartes[i]];
            }
            
            // Placer sous la pioche existante (au début du tableau)
            this.pioche = nouvellesCartes.concat(this.pioche);
            this.defausse = [];
        }
        return true;
    }

    actionPiocher(numJoueur) {
        if (numJoueur !== this.tourActuel) return { ok: false, erreur: "Ce n'est pas ton tour." };
        if (this.aJoueCeTour) return { ok: false, erreur: 'Tu as déjà pioché ou ramassé la terre ce tour-ci.' };

        if (!this._recyclerDefausseSiBesoin(2)) {
            const recap = this.terminerManche('pioche_epuisee');
            return { ok: true, piocheEpuisee: true, recapManche: recap };
        }

        const joueur = this.joueurs[numJoueur];
        const c1 = this.pioche.pop();
        const c2 = this.pioche.pop();
        joueur.main.push(c1, c2);
        const troisRougesExposes = this.gererCartesEntranteMain(numJoueur);


        this.aJoueCeTour = true;
        return { ok: true, cartesRecues: [c1, c2], troisRougesExposes };
    }

    // =========================================================================
    // TOUR DE JEU — ÉTAPE 1b : RAMASSER LA TERRE
    // =========================================================================
    actionRamasserTerre(numJoueur, groupesOuverture) {
        if (numJoueur !== this.tourActuel) return { ok: false, erreur: "Ce n'est pas ton tour." };
        if (this.aJoueCeTour) return { ok: false, erreur: 'Tu as déjà pioché ou ramassé la terre ce tour-ci.' };
        if (this.defausse.length === 0) return { ok: false, erreur: 'La défausse est vide.' };

        const joueur = this.joueurs[numJoueur];
        const numEquipe = this.equipeDuJoueur(numJoueur);
        const equipe = this.equipes[numEquipe];

        const carteDessus = this.defausse[this.defausse.length - 1];
        if (carteDessus.estJoker || carteDessus.valeur === '2') {
            return { ok: false, erreur: 'Impossible de ramasser sur une carte spéciale (Joker ou 2).' };
        }
        if (carteDessus.est3Noir) {
            return { ok: false, erreur: 'La pile est gelée : un 3 Noir est au-dessus.' };
        }

        const pileGelee = this.defausse.some(c => c.estJoker || c.valeur === '2');
        const nbRequis = pileGelee ? 3 : 2;

        const cartesRequises = joueur.main.filter(c => !c.estJoker && c.valeur === carteDessus.valeur).slice(0, nbRequis);
        if (cartesRequises.length < nbRequis) {
            return { ok: false, erreur: pileGelee ? `La terre est gelée : il faut trois ${carteDessus.valeur} naturels en main pour ramasser.` : `Il faut deux ${carteDessus.valeur} naturels en main pour ramasser la terre.` };
        }

        // Le lot disponible pour composer les combinaisons d'ouverture : main + toute la pile
        const pileEntiere = this.defausse.slice();
        const poolDisponible = new Map();
        for (const c of joueur.main) poolDisponible.set(c.id, c);
        for (const c of pileEntiere) poolDisponible.set(c.id, c);

        let groupesValides = null;
        if (!equipe.aOuvert) {
            if (!groupesOuverture || groupesOuverture.length === 0) {
                return { ok: false, erreur: "Ton équipe n'a pas encore ouvert : indique les combinaisons qui prouvent que tu peux ouvrir avec la paire et la pile." };
            }
            const resultat = this._validerLotDeGroupes(groupesOuverture, poolDisponible, numEquipe, { verifierSeuil: true, exigerPaireEtCarte: { cartesRequises, carteDessus } });
            if (!resultat.ok) {
                joueur.aPerduDroitOuverture = true;
                return { ok: false, erreur: "Ouverture invalide : " + resultat.erreur + " Tu as perdu le droit d'ouvrir pour cette manche." };
            }
            groupesValides = resultat.groupes;
        } else if (groupesOuverture && groupesOuverture.length > 0) {
            // L'équipe a déjà ouvert : les groupes sont facultatifs mais doivent rester valides
            const resultat = this._validerLotDeGroupes(groupesOuverture, poolDisponible, numEquipe, { verifierSeuil: false });
            if (!resultat.ok) return resultat;
            groupesValides = resultat.groupes;
        }

        // On pioche 1 carte bonus (si possible) + on ramasse la pile
        let cartePiochee = null;
        if (this.pioche.length >= 1) {
            cartePiochee = this.pioche.pop();
            joueur.main.push(cartePiochee);
        }

        joueur.main.push(...pileEntiere);
        this.defausse = [];

        const troisRougesExposes = this.gererCartesEntranteMain(numJoueur);

        let ouvertureRealisee = false;
        if (groupesValides) {
            ouvertureRealisee = this._appliquerGroupesValides(groupesValides, numJoueur, numEquipe);
        }


        this.aJoueCeTour = true;
        return {
            ok: true,
            cartePiochee,
            pileRamassee: pileEntiere,
            troisRougesExposes,
            ouvertureRealisee
        };
    }

    // =========================================================================
    // TOUR DE JEU — ÉTAPE 2 : DESCENDRE DES COMBINAISONS (facultatif)
    // =========================================================================
    // groupes : [{ cartesId: [...] }] pour de nouvelles combinaisons,
    //        ou [{ valeur: 'A', cartesId: [...] }] pour compléter une
    //        combinaison déjà posée par l'équipe.
    actionDescendreCombinaisons(numJoueur, groupes) {
        if (numJoueur !== this.tourActuel) return { ok: false, erreur: "Ce n'est pas ton tour." };
        if (!this.aJoueCeTour) return { ok: false, erreur: "Tu dois d'abord piocher ou ramasser la terre." };
        if (!groupes || groupes.length === 0) return { ok: false, erreur: 'Aucune combinaison fournie.' };

        const joueur = this.joueurs[numJoueur];
        const numEquipe = this.equipeDuJoueur(numJoueur);
        const equipe = this.equipes[numEquipe];

        if (!equipe.aOuvert && joueur.aPerduDroitOuverture) {
            return { ok: false, erreur: "Suite à un faux départ de ton partenaire, tu as perdu le droit d'ouvrir de ta main. Tu dois obligatoirement ramasser la terre pour ouvrir." };
        }

        const poolDisponible = new Map();
        for (const c of joueur.main) poolDisponible.set(c.id, c);

        const resultat = this._validerLotDeGroupes(groupes, poolDisponible, numEquipe, { verifierSeuil: !equipe.aOuvert });
        if (!resultat.ok) {
            if (!equipe.aOuvert) {
                joueur.aFaitFauxDepart = true;
                return { ok: false, echecOuverture: true, erreur: "Ouverture invalide : " + resultat.erreur + " (Si tu termines ton tour sans ouvrir, ton partenaire sera pénalisé)." };
            }
            return resultat;
        }
        
        let cartesUtilisees = 0;
        for (const g of resultat.groupes) {
            if (g.type === 'nouvelle') cartesUtilisees += g.cartes.length;
            else if (g.type === 'ajout') cartesUtilisees += g.cartesAjoutees.length;
        }

        const cartesRestantes = joueur.main.length - cartesUtilisees;
        if (cartesRestantes <= 1) {
            if (this.sortieRefusee[numJoueur] === true) {
                return { ok: false, erreur: "Ton allié a refusé que tu sortes." };
            }
            // Simuler pour vérifier si les canastas requises sont atteintes
            let aPure = false;
            let aImpure = false;
            const tableClone = {};
            for (const val in equipe.table) {
                tableClone[val] = { cartes: equipe.table[val].cartes.slice(), valeur: equipe.table[val].valeur };
            }
            for (const g of resultat.groupes) {
                if (g.type === 'nouvelle') {
                    tableClone[g.valeur] = { cartes: g.cartes.slice(), valeur: g.valeur };
                } else if (g.type === 'ajout') {
                    tableClone[g.valeur].cartes.push(...g.cartesAjoutees);
                }
            }
            for (const val in tableClone) {
                const combo = tableClone[val];
                if (combo.cartes.length >= 7) {
                    const estPure = combo.cartes.every(c => !c.estJoker && (combo.valeur === '2' || c.valeur !== '2'));
                    if (estPure) aPure = true;
                    else aImpure = true;
                }
            }
            if (!(aPure && aImpure)) {
                return { ok: false, erreur: "Tu ne peux pas te retrouver avec 0 ou 1 carte en main si ton équipe n'a pas au moins une Canasta Pure ET une Canasta Impure." };
            }
        }

        const ouvertureRealisee = this._appliquerGroupesValides(resultat.groupes, numJoueur, numEquipe);
        
        if (joueur.main.length === 0) {
            const recap = this.terminerManche('sortie', numJoueur);
            return { ok: true, ouvertureRealisee, mancheTerminee: true, recapManche: recap };
        }
        
        return { ok: true, ouvertureRealisee, mancheTerminee: false };
    }

    // Valide un lot de groupes de façon ATOMIQUE (rien n'est appliqué si un
    // groupe est invalide, ou si le total n'atteint pas le seuil requis).
    _validerLotDeGroupes(groupes, poolDisponible, numEquipe, options) {
        const equipe = this.equipes[numEquipe];
        const idsUtilises = new Set();
        const groupesValides = [];
        let pointsNouvellesCombinaisons = 0;
        let contientPaireEtCarte = !options.exigerPaireEtCarte;

        for (const groupe of groupes) {
            const cartesId = groupe.cartesId || [];
            if (cartesId.length < 3 && !groupe.valeur) {
                return { ok: false, erreur: 'Une combinaison doit contenir au moins 3 cartes.' };
            }
            const cartes = [];
            for (const id of cartesId) {
                if (idsUtilises.has(id)) return { ok: false, erreur: 'Une carte ne peut pas être utilisée deux fois.' };
                const carte = poolDisponible.get(id);
                if (!carte) return { ok: false, erreur: "Une des cartes sélectionnées n'est pas disponible." };
                cartes.push(carte);
                idsUtilises.add(id);
            }

            if (groupe.valeur) {
                // Ajout à une combinaison déjà posée par l'équipe
                if (!equipe.aOuvert) {
                    return { ok: false, erreur: "Ton équipe n'a pas encore ouvert : impossible de compléter une combinaison." };
                }
                let cibleKey = groupe.valeur;
                if (equipe.table[cibleKey] && equipe.table[cibleKey].estCanasta) {
                    let counter = 2;
                    while (equipe.table[`${groupe.valeur}_${counter}`]) {
                        if (!equipe.table[`${groupe.valeur}_${counter}`].estCanasta) {
                            cibleKey = `${groupe.valeur}_${counter}`;
                            break;
                        }
                        counter++;
                    }
                }
                const combinaisonExistante = equipe.table[cibleKey];
                if (!combinaisonExistante) {
                    return { ok: false, erreur: `Ton équipe n'a pas encore de combinaison de ${groupe.valeur}.` };
                }
                if (groupe.valeur === '2' && combinaisonExistante.verrouilleePure) {
                    if (cartes.some(c => c.estJoker)) {
                        return { ok: false, erreur: "Impossible d'ajouter un Joker à une combinaison de 2 pure." };
                    }
                }
                const cartesCombinees = combinaisonExistante.cartes.concat(cartes);
                const validation = validerGroupeDeCartes(cartesCombinees);
                if (!validation.valide) return { ok: false, erreur: validation.raison };

                groupesValides.push({ type: 'ajout', valeur: cibleKey, cartesAjoutees: cartes, validation });
            } else {
                const validation = validerGroupeDeCartes(cartes);
                if (!validation.valide) return { ok: false, erreur: validation.raison };
                let meldKey = validation.valeur;
                let convertToAjout = false;

                if (equipe.table[meldKey]) {
                    if (equipe.table[meldKey].estCanasta) {
                        let counter = 2;
                        while (equipe.table[`${validation.valeur}_${counter}`]) {
                            if (!equipe.table[`${validation.valeur}_${counter}`].estCanasta) {
                                meldKey = `${validation.valeur}_${counter}`;
                                convertToAjout = true;
                                break;
                            }
                            counter++;
                        }
                        if (!convertToAjout) {
                            meldKey = `${validation.valeur}_${counter}`;
                        }
                    } else {
                        convertToAjout = true;
                    }
                }

                if (convertToAjout) {
                    const combinaisonExistante = equipe.table[meldKey];
                    if (validation.valeur === '2' && combinaisonExistante.verrouilleePure) {
                        if (cartes.some(c => c.estJoker)) {
                            return { ok: false, erreur: "Impossible d'ajouter un Joker à une combinaison de 2 pure." };
                        }
                    }
                    const cartesCombinees = combinaisonExistante.cartes.concat(cartes);
                    const comboValidation = validerGroupeDeCartes(cartesCombinees);
                    if (!comboValidation.valide) return { ok: false, erreur: comboValidation.raison };

                    groupesValides.push({ type: 'ajout', valeur: meldKey, cartesAjoutees: cartes, validation: comboValidation });
                } else {
                    groupesValides.push({ type: 'nouvelle', cleUnique: meldKey, valeur: validation.valeur, cartes, validation });
                    pointsNouvellesCombinaisons += validation.pointsFaciaux;
                }
            }

            if (options.exigerPaireEtCarte) {
                const carteDessus = options.exigerPaireEtCarte.carteDessus;
                const nbRequis = options.exigerPaireEtCarte.cartesRequises.length;
                const cartesDuGroupe = groupe.cartesId || [];
                
                // Si la combinaison examinée contient bien la carte de la défausse
                if (cartesDuGroupe.includes(carteDessus.id)) {
                    let nbNaturelles = 0;
                    // On compte combien de vraies cartes de la même valeur l'accompagnent
                    for (let id of cartesDuGroupe) {
                        if (id !== carteDessus.id) {
                            let c = poolDisponible.get(id);
                            if (c && !c.estJoker && c.valeur === carteDessus.valeur) {
                                nbNaturelles++;
                            }
                        }
                    }
                    // Si on a au moins le nombre requis de cartes naturelles (peu importe lesquelles !), c'est validé
                    if (nbNaturelles >= nbRequis) contientPaireEtCarte = true;
                }
            }
        }

        if (options.exigerPaireEtCarte && !contientPaireEtCarte) {
            return { ok: false, erreur: "Une des combinaisons doit inclure la paire et la carte ramassée sur la défausse." };
        }

        if (options.verifierSeuil) {
            const seuil = calculerSeuilOuverture(equipe.score);
            if (pointsNouvellesCombinaisons < seuil) {
                return { ok: false, erreur: `Il faut au moins ${seuil} points pour ouvrir (tu proposes ${pointsNouvellesCombinaisons}).` };
            }
        }

        return { ok: true, groupes: groupesValides };
    }

    _appliquerGroupesValides(groupesValides, numJoueur, numEquipe) {
        const joueur = this.joueurs[numJoueur];
        const equipe = this.equipes[numEquipe];
        let ouvertureRealisee = false;

        for (const g of groupesValides) {
            if (g.type === 'nouvelle') {
                for (const carte of g.cartes) {
                    const idx = joueur.main.findIndex(c => c.id === carte.id);
                    if (idx !== -1) joueur.main.splice(idx, 1);
                }
                const key = g.cleUnique || g.valeur;
                equipe.table[key] = {
                    valeur: g.valeur,
                    cartes: g.cartes.slice(),
                    verrouilleePure: (g.valeur === '2' && !g.cartes.some(c => c.estJoker))
                };
            } else if (g.type === 'ajout') {
                for (const carte of g.cartesAjoutees) {
                    const idx = joueur.main.findIndex(c => c.id === carte.id);
                    if (idx !== -1) joueur.main.splice(idx, 1);
                }
                equipe.table[g.valeur].cartes.push(...g.cartesAjoutees);
            }
        }

        if (!equipe.aOuvert) {
            equipe.aOuvert = true;
            ouvertureRealisee = true;
        }
        return ouvertureRealisee;
    }

    // =========================================================================
    // TOUR DE JEU — ÉTAPE 3 : JETER (obligatoire, termine le tour)
    // =========================================================================
    actionJeter(numJoueur, carteId) {
        if (numJoueur !== this.tourActuel) return { ok: false, erreur: "Ce n'est pas ton tour." };
        if (!this.aJoueCeTour) return { ok: false, erreur: "Tu dois d'abord piocher ou ramasser la terre." };

        const joueur = this.joueurs[numJoueur];
        const idx = joueur.main.findIndex(c => c.id === carteId);
        if (idx === -1) return { ok: false, erreur: 'Cette carte n\'est pas dans ta main.' };

        const carte = joueur.main[idx];

        const numEquipe = this.equipeDuJoueur(numJoueur);
        const feraSortirLaMain = joueur.main.length === 1;
        if (feraSortirLaMain) {
            if (this.sortieRefusee[numJoueur] === true) {
                return { ok: false, erreur: "Ton allié a refusé que tu sortes." };
            }
            if (!this.peutSortir(numEquipe)) {
                return { ok: false, erreur: "Tu ne peux pas terminer la manche sans que ton équipe ait au moins une Canasta Pure ET une Canasta Impure." };
            }
        }

        if (joueur.aFaitFauxDepart && !this.equipes[numEquipe].aOuvert) {
            const partenaireNum = this.equipes[numEquipe].membres.find(m => m !== numJoueur);
            this.joueurs[partenaireNum].aPerduDroitOuverture = true;
        }
        joueur.aFaitFauxDepart = false;

        joueur.main.splice(idx, 1);
        this.defausse.push(carte);

        this.aJoueCeTour = false;

        if (joueur.main.length === 0) {
            const recap = this.terminerManche('sortie', numJoueur);
            return { ok: true, carteJetee: carte, mancheTerminee: true, recapManche: recap };
        }

        this.sortieRefusee = {};
        this.tourActuel = (this.tourActuel % 4) + 1;
        return { ok: true, carteJetee: carte, mancheTerminee: false, prochainTour: this.tourActuel };
    }

    // =========================================================================
    // FIN DE MANCHE — CALCUL DES SCORES
    // =========================================================================
    terminerManche(raison, numJoueurSorti) {
        const recap = { raison, equipes: {}, numJoueurSorti: numJoueurSorti || null };

        for (const numEquipe of [1, 2]) {
            const equipe = this.equipes[numEquipe];
            let points = 0;
            const detail = { troisRouges: 0, canastas: [], valeurCombinaisons: 0, valeurMainRestante: 0 };

            for (const combinaison of Object.values(equipe.table)) {
                const cartes = combinaison.cartes;
                const estCanasta = cartes.length >= 7;
                const estPure = cartes.every(c => !c.estJoker && (combinaison.valeur === '2' || c.valeur !== '2'));
                const valeurFaciale = cartes.reduce((s, c) => s + c.points, 0);
                detail.valeurCombinaisons += valeurFaciale;

                if (estCanasta) {
                    let pts = 0;
                    if (combinaison.valeur === '2') pts = estPure ? 3000 : 1500;
                    else if (combinaison.valeur === 'A') pts = estPure ? 1500 : 750;
                    else pts = estPure ? 500 : 350;
                    detail.canastas.push({ valeur: combinaison.valeur, pure: estPure, points: pts, taille: cartes.length });
                    points += pts;
                }
            }

            const penaliteTroisRouges = !equipe.aOuvert || detail.canastas.length === 0;
            detail.troisRouges = equipe.troisRouges.length * (penaliteTroisRouges ? -100 : 100);
            points += detail.troisRouges;
            
            let pointsEnArriere = false;
            if (numJoueurSorti) {
                const equipeSortante = this.equipeDuJoueur(numJoueurSorti);
                if (numEquipe !== equipeSortante && detail.canastas.length === 0) {
                    pointsEnArriere = true;
                }
            }

            if (pointsEnArriere) {
                points -= detail.valeurCombinaisons;
            } else {
                points += detail.valeurCombinaisons;
            }

            for (const numJ of equipe.membres) {
                const valeurMain = this.joueurs[numJ].main.reduce((s, c) => s + c.points, 0);
                detail.valeurMainRestante += valeurMain;
            }
            points -= detail.valeurMainRestante;
            
            if (raison === 'sortie' && numJoueurSorti && this.equipeDuJoueur(numJoueurSorti) === numEquipe) {
                points += 100;
                detail.bonusSortie = 100;
            }

            equipe.score += points;
            recap.equipes[numEquipe] = { pointsManche: points, scoreTotal: equipe.score, detail };
        }

        this.dernierRecapManche = recap;

        if (recap.equipes[1].scoreTotal >= 15000 || recap.equipes[2].scoreTotal >= 15000) {
            this.partieTerminee = true;
            this.enJeu = false;
            this.vainqueur = recap.equipes[1].scoreTotal >= recap.equipes[2].scoreTotal ? 1 : 2;
        } else {
            this.enJeu = false;
            this.prochainPremierJoueur = numJoueurSorti ? (numJoueurSorti % 4) + 1 : (this.tourActuel % 4) + 1;
        }

        return recap;
    }

    // =========================================================================
    // ÉTAT PUBLIC (vue personnalisée par joueur — ne fuit jamais les mains adverses)
    // =========================================================================
    getEtatPourJoueur(numJoueur) {
        const tailleMains = {};
        for (let i = 1; i <= 4; i++) tailleMains[i] = this.joueurs[i].main.length;

        const equipesPubliques = {};
        for (const numEquipe of [1, 2]) {
            const e = this.equipes[numEquipe];
            equipesPubliques[numEquipe] = {
                score: e.score,
                aOuvert: e.aOuvert,
                seuilOuverture: calculerSeuilOuverture(e.score),
                troisRouges: e.troisRouges.map(serialiserCarte),
                table: Object.fromEntries(
                    Object.entries(e.table).map(([cleUnique, combi]) => [cleUnique, {
                        valeur: combi.valeur,
                        cartes: combi.cartes.map(serialiserCarte),
                        estCanasta: combi.cartes.length >= 7,
                        verrouilleePure: combi.verrouilleePure,
                        points: combi.cartes.reduce((total, c) => total + c.points, 0)
                    }])
                )
            };
        }

        return {
            enJeu: this.enJeu,
            partieTerminee: this.partieTerminee,
            vainqueur: this.vainqueur,
            tourActuel: this.tourActuel,
            aJoueCeTour: this.aJoueCeTour,
            monNumero: numJoueur,
            monEquipe: this.equipeDuJoueur(numJoueur),
            maMain: this.joueurs[numJoueur].main.map(serialiserCarte),
            tailleMains,
            tailleDefausse: this.defausse.length,
            defausseVisible: this.defausse.map(serialiserCarte),
            carteDessusDefausse: this.defausse.length > 0 ? serialiserCarte(this.defausse[this.defausse.length - 1]) : null,
            terreGelee: this.defausse.some(c => c.estJoker || c.valeur === '2'),
            taillePioche: this.pioche.length,
            equipes: equipesPubliques,
            dernierRecapManche: this.dernierRecapManche
        };
    }
}

// =========================================================================
// VALIDATION D'UNE COMBINAISON — RÈGLE D'OR + EXCEPTION DES 2
// =========================================================================
function validerGroupeDeCartes(cartes) {
    if (cartes.length < 3) return { valide: false, raison: 'Une combinaison doit contenir au moins 3 cartes.' };
    if (cartes.some(c => c.est3Noir)) return { valide: false, raison: 'Les 3 Noirs ne peuvent jamais être combinés.' };
    if (cartes.every(c => c.estJoker)) return { valide: false, raison: 'Une combinaison ne peut pas être composée uniquement de Jokers.' };

    const naturellesStrictes = cartes.filter(c => !c.estJoker && c.valeur !== '2');
    const deux = cartes.filter(c => c.valeur === '2' && !c.estJoker);
    const jokers = cartes.filter(c => c.estJoker);

    let valeurCible, nbNaturelles, nbWildcards;

    if (naturellesStrictes.length > 0) {
        valeurCible = naturellesStrictes[0].valeur;
        if (!naturellesStrictes.every(c => c.valeur === valeurCible)) {
            return { valide: false, raison: 'Toutes les cartes naturelles doivent avoir la même valeur.' };
        }
        nbNaturelles = naturellesStrictes.length;
        nbWildcards = deux.length + jokers.length;
    } else if (deux.length > 0) {
        valeurCible = '2';
        nbNaturelles = deux.length;
        nbWildcards = jokers.length;
    } else {
        return { valide: false, raison: 'Combinaison invalide.' };
    }

    if (nbNaturelles <= nbWildcards) {
        return { valide: false, raison: 'Il faut strictement plus de cartes naturelles que de Jokers/2 (règle d\'or).' };
    }

    const estPure = nbWildcards === 0;
    const pointsFaciaux = cartes.reduce((s, c) => s + c.points, 0);

    return {
        valide: true,
        valeur: valeurCible,
        nbNaturelles,
        nbWildcards,
        estCanasta: cartes.length >= 7,
        estPure,
        pointsFaciaux
    };
}

function calculerSeuilOuverture(scoreEquipe) {
    if (scoreEquipe < 3000) return 60;
    if (scoreEquipe < 5000) return 90;
    if (scoreEquipe < 7000) return 120;
    return 160;
}

module.exports = { PartieCanasta, Carte, validerGroupeDeCartes, calculerSeuilOuverture, calculerPointsCarte };