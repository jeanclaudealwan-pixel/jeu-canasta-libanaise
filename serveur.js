const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { PartieCanasta } = require('./serveur-logique/Jeu'); 

const app = express();
const serveur = http.createServer(app);
const io = new Server(serveur);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

let salons = {}; // Map of roomId -> room object
let prochainSalonId = 1;
let joueursDansSalons = {}; // { socketId: roomId }
let deconnexionsPendantPartie = {}; // { token: { roomId, numero, timeout } }

function getSalonPourSocket(socketId) {
    const salonId = joueursDansSalons[socketId];
    return salonId ? salons[salonId] : null;
}

class BotJoueur {
    constructor(numero, salon, serverIo) {
        this.numero = numero;
        this.salon = salon;
        this.partie = salon.partie;
        this.io = serverIo;
    }
    jouerTour() {
        setTimeout(() => {
            if (!this.partie || !this.partie.enJeu) return;
            const resPiocher = this.partie.actionPiocher(this.numero);
            if (resPiocher.ok) {
                diffuserEtatGlobal(this.salon);
                if (resPiocher.piocheEpuisee) {
                    diffuserAlerte(this.salon, "La pioche est épuisée ! Fin de la manche.");
                    return;
                }
            }
            
            const main = this.partie.joueurs[this.numero].main;
            const valMap = {};
            for (let c of main) {
                if (!c.estJoker && c.valeur !== '2' && c.valeur !== '3') {
                    valMap[c.valeur] = (valMap[c.valeur] || 0) + 1;
                }
            }
            const valeursMultiples = Object.keys(valMap).filter(v => valMap[v] >= 3);
            if (valeursMultiples.length > 0) {
                const groupes = valeursMultiples.map(v => ({
                    cartesId: main.filter(c => c.valeur === v).map(c => c.id)
                }));
                const resDescendre = this.partie.actionDescendreCombinaisons(this.numero, groupes);
                if (resDescendre.ok) diffuserEtatGlobal(this.salon);
            }
            
            let jeterId = main[0].id;
            const normales = main.filter(c => !c.estJoker && c.valeur !== '2');
            if (normales.length > 0) {
                normales.sort((a,b) => a.points - b.points);
                jeterId = normales[0].id;
            } else {
                const deux = main.filter(c => c.valeur === '2');
                if (deux.length > 0) jeterId = deux[0].id;
            }
            
            const resJeter = this.partie.actionJeter(this.numero, jeterId);
            if (resJeter.ok) {
                if (resJeter.mancheTerminee) {
                    diffuserAlerte(this.salon, `Manche terminée ! Raison : ${resJeter.recapManche.raison}`);
                } else {
                    diffuserChangementTour(this.salon, resJeter.prochainTour);
                    verifierTourBot(this.salon, resJeter.prochainTour);
                }
                diffuserEtatGlobal(this.salon);
            }
        }, 1500);
    }
}

function verifierTourBot(salon, numTour) {
    if (salon && salon.bots[numTour]) {
        salon.bots[numTour].jouerTour();
    }
}

function diffuserAlerte(salon, message) {
    for (let sId in salon.joueurs) {
        if (!sId.startsWith('bot-')) io.to(sId).emit('alerteJeu', message);
    }
    for (let sId of salon.spectateurs) {
        io.to(sId).emit('alerteJeu', message);
    }
}

function diffuserChangementTour(salon, numTour) {
    for (let sId in salon.joueurs) {
        if (!sId.startsWith('bot-')) io.to(sId).emit('changementDeTour', numTour);
    }
    for (let sId of salon.spectateurs) {
        io.to(sId).emit('changementDeTour', numTour);
    }
}

function diffuserMessageGlobal(salon, message) {
    for (let sId in salon.joueurs) {
        if (!sId.startsWith('bot-')) io.to(sId).emit('messageGlobal', message);
    }
    for (let sId of salon.spectateurs) {
        io.to(sId).emit('messageGlobal', message);
    }
}

function diffuserEtatGlobal(salon) {
    if (!salon || !salon.partie) return;
    for (let idConnexion in salon.joueurs) {
        if (idConnexion.startsWith('bot-')) continue;
        let num = salon.joueurs[idConnexion];
        let etatJoueur = salon.partie.getEtatPourJoueur(num);
        io.to(idConnexion).emit('miseAJourEtat', etatJoueur);
    }
    if (salon.spectateurs.size > 0) {
        let etatSpectateur = salon.partie.getEtatPourJoueur(1);
        etatSpectateur.maMain = [];
        etatSpectateur.monNumero = null;
        etatSpectateur.monEquipe = null;
        for (let spec of salon.spectateurs) {
            io.to(spec).emit('miseAJourEtat', etatSpectateur);
        }
    }
}

function getListeSalonsData() {
    return Object.values(salons).map(s => ({
        id: s.id,
        nom: s.nom,
        nbJoueurs: Object.keys(s.joueurs).length,
        enCours: s.enCours
    }));
}

function envoyerMiseAJourSalon(salon) {
    const joueursArray = [];
    for (let sId in salon.joueurs) {
        joueursArray.push({
            numero: salon.joueurs[sId],
            nom: sId.startsWith('bot-') ? 'Bot' : 'Joueur',
            estBot: sId.startsWith('bot-')
        });
    }
    const data = {
        id: salon.id,
        nom: salon.nom,
        joueurs: joueursArray,
        hote: salon.hote
    };
    for (let sId in salon.joueurs) {
        if (!sId.startsWith('bot-')) io.to(sId).emit('miseAJourSalon', data);
    }
    for (let sId of salon.spectateurs) {
        io.to(sId).emit('miseAJourSalon', data);
    }
}

function quitterLeSalon(socketId) {
    const salon = getSalonPourSocket(socketId);
    if (!salon) return;
    
    if (salon.spectateurs.has(socketId)) {
        salon.spectateurs.delete(socketId);
    } else if (salon.joueurs[socketId]) {
        let numeroLibere = salon.joueurs[socketId];
        
        if (salon.enCours) {
            deconnexionsPendantPartie[socketId] = {
                roomId: salon.id,
                numero: numeroLibere,
                timeout: setTimeout(() => {
                    salon.placesDisponibles.push(numeroLibere);
                    salon.placesDisponibles.sort((a, b) => a - b);
                    delete deconnexionsPendantPartie[socketId];
                    delete salon.joueurs[socketId];
                    diffuserMessageGlobal(salon, `Le Joueur ${numeroLibere} a définitivement quitté la table.`);
                    envoyerMiseAJourSalon(salon);
                }, 60000)
            };
        } else {
            salon.placesDisponibles.push(numeroLibere);
            salon.placesDisponibles.sort((a, b) => a - b);
            delete salon.joueurs[socketId];
            
            if (salon.hote === socketId) {
                let autresJoueurs = Object.keys(salon.joueurs).filter(id => !id.startsWith('bot-'));
                if (autresJoueurs.length > 0) {
                    salon.hote = autresJoueurs[0];
                } else {
                    delete salons[salon.id];
                    io.emit('listeSalons', getListeSalonsData());
                    delete joueursDansSalons[socketId];
                    return;
                }
            }
        }
    }
    
    delete joueursDansSalons[socketId];
    if (salons[salon.id]) envoyerMiseAJourSalon(salon);
    io.emit('listeSalons', getListeSalonsData());
}

io.on('connection', (socket) => {
    console.log(`Nouvelle connexion détectée : ${socket.id}`);
    
    socket.emit('listeSalons', getListeSalonsData());

    socket.on('listerSalons', () => {
        socket.emit('listeSalons', getListeSalonsData());
    });

    socket.on('creerSalon', (nomSalon) => {
        if (Object.keys(salons).length >= 20) {
            return socket.emit('salonErreur', 'Nombre maximum de salons atteint.');
        }
        if (joueursDansSalons[socket.id]) {
            quitterLeSalon(socket.id);
        }
        
        const salonId = 'salon_' + prochainSalonId++;
        const nom = nomSalon || `Salon #${prochainSalonId - 1}`;
        
        const nouveauSalon = {
            id: salonId,
            nom: nom,
            hote: socket.id,
            joueurs: {},
            spectateurs: new Set(),
            partie: null,
            bots: {},
            placesDisponibles: [1, 2, 3, 4],
            enCours: false
        };
        salons[salonId] = nouveauSalon;
        
        let numeroJoueur = nouveauSalon.placesDisponibles.shift();
        nouveauSalon.joueurs[socket.id] = numeroJoueur;
        joueursDansSalons[socket.id] = salonId;
        
        socket.emit('salonCree', {
            id: salonId,
            nom: nom,
            joueurs: [{ numero: numeroJoueur, nom: 'Joueur', estBot: false }],
            hote: socket.id
        });
        socket.emit('attributionSiege', numeroJoueur);
        
        io.emit('listeSalons', getListeSalonsData());
    });

    socket.on('rejoindreSalon', (salonId) => {
        const salon = salons[salonId];
        if (!salon) {
            return socket.emit('salonErreur', "Ce salon n'existe plus.");
        }
        if (joueursDansSalons[socket.id]) {
            quitterLeSalon(socket.id);
        }

        joueursDansSalons[socket.id] = salonId;

        if (salon.placesDisponibles.length > 0) {
            let numeroJoueur = salon.placesDisponibles.shift();
            salon.joueurs[socket.id] = numeroJoueur;
            
            socket.emit('attributionSiege', numeroJoueur);
            socket.emit('salonRejoins', {
                id: salon.id,
                nom: salon.nom,
                joueurs: Object.keys(salon.joueurs).map(sId => ({
                    numero: salon.joueurs[sId], nom: sId.startsWith('bot-') ? 'Bot' : 'Joueur', estBot: sId.startsWith('bot-')
                })),
                hote: salon.hote,
                monNumero: numeroJoueur
            });
            
            envoyerMiseAJourSalon(salon);
            io.emit('listeSalons', getListeSalonsData());
        } else {
            salon.spectateurs.add(socket.id);
            socket.emit('modeSpectateur');
            socket.emit('salonRejoins', {
                id: salon.id,
                nom: salon.nom,
                joueurs: Object.keys(salon.joueurs).map(sId => ({
                    numero: salon.joueurs[sId], nom: sId.startsWith('bot-') ? 'Bot' : 'Joueur', estBot: sId.startsWith('bot-')
                })),
                hote: salon.hote,
                monNumero: null
            });
            envoyerMiseAJourSalon(salon);
        }
    });

    socket.on('quitterSalon', () => {
        quitterLeSalon(socket.id);
        socket.emit('listeSalons', getListeSalonsData());
    });

    socket.on('ajouterBot', () => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || salon.hote !== socket.id || salon.enCours) return;
        
        if (salon.placesDisponibles.length > 0) {
            let num = salon.placesDisponibles.shift();
            let botId = `bot-${num}-${Date.now()}`;
            salon.joueurs[botId] = num;
            
            envoyerMiseAJourSalon(salon);
            io.emit('listeSalons', getListeSalonsData());
        }
    });

    socket.on('demarrerPartie', () => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || salon.hote !== socket.id || salon.enCours) return;

        while (salon.placesDisponibles.length > 0) {
            let num = salon.placesDisponibles.shift();
            let botId = `bot-${num}-${Date.now()}`;
            salon.joueurs[botId] = num;
        }

        salon.enCours = true;
        salon.partie = new PartieCanasta();
        
        for (let sId in salon.joueurs) {
            if (sId.startsWith('bot-')) {
                let num = salon.joueurs[sId];
                salon.bots[num] = new BotJoueur(num, salon, io);
            }
        }

        diffuserAlerte(salon, "La table est complète ! Distribution des cartes...");
        salon.partie.demarrerNouvellePartie();
        diffuserEtatGlobal(salon);
        diffuserChangementTour(salon, salon.partie.tourActuel);
        verifierTourBot(salon, salon.partie.tourActuel);
        
        envoyerMiseAJourSalon(salon);
        io.emit('listeSalons', getListeSalonsData());
    });

    // Game Events
    socket.on('demandeJouerCarte', (carteId) => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.partie) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;

        let resultat = salon.partie.actionJeter(numeroJoueur, carteId);
        
        if (resultat.ok) {
            if (resultat.mancheTerminee) {
                diffuserAlerte(salon, `Manche terminée ! Raison : ${resultat.recapManche.raison}`);
            } else {
                diffuserChangementTour(salon, resultat.prochainTour);
                verifierTourBot(salon, resultat.prochainTour);
            }
            diffuserEtatGlobal(salon);
        } else {
            socket.emit('alerteJeu', resultat.erreur);
            socket.emit('miseAJourEtat', salon.partie.getEtatPourJoueur(numeroJoueur));
        }
    });

    socket.on('demandePiocher', () => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.partie) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;

        let resultat = salon.partie.actionPiocher(numeroJoueur);

        if (resultat.ok) {
            diffuserEtatGlobal(salon);
            if (resultat.piocheEpuisee) {
                diffuserAlerte(salon, "La pioche est épuisée ! Fin de la manche.");
            }
        } else {
            socket.emit('alerteJeu', resultat.erreur);
        }
    });

    socket.on('demandeRamasserTerre', (groupesOuverture) => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.partie) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;

        let resultat = salon.partie.actionRamasserTerre(numeroJoueur, groupesOuverture);

        if (resultat.ok) {
            diffuserAlerte(salon, `Le Joueur ${numeroJoueur} a ramassé la terre (+1 carte piochée) !`);
            diffuserEtatGlobal(salon);
        } else {
            socket.emit('alerteJeu', resultat.erreur);
        }
    });

    socket.on('demandeDescendreCombinaison', (groupesProposees) => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.partie) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;

        let resultat = salon.partie.actionDescendreCombinaisons(numeroJoueur, groupesProposees);

        if (resultat.ok) {
            socket.emit('alerteJeu', "Combinaisons validées !");
            if (resultat.mancheTerminee) {
                diffuserAlerte(salon, `Manche terminée ! Raison : ${resultat.recapManche.raison}`);
                envoyerMiseAJourSalon(salon);
            }
            diffuserEtatGlobal(salon);
        } else {
            socket.emit('alerteJeu', resultat.erreur);
        }
    });

    socket.on('chatMessage', (msg) => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon) return;
        let nomExpediteur = "Spectateur";
        if (salon.joueurs[socket.id]) {
            nomExpediteur = `Joueur ${salon.joueurs[socket.id]}`;
        }
        
        const messageData = {
            expediteur: nomExpediteur,
            message: msg,
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        };
        
        for (let sId in salon.joueurs) {
            if (!sId.startsWith('bot-')) io.to(sId).emit('nouveauMessage', messageData);
        }
        for (let sId of salon.spectateurs) {
            io.to(sId).emit('nouveauMessage', messageData);
        }
    });

    socket.on('envoyerEmoji', (emoji) => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.enCours) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;
        
        const data = { numeroJoueur, emoji };
        for (let sId in salon.joueurs) {
            if (!sId.startsWith('bot-')) io.to(sId).emit('recevoirEmoji', data);
        }
        for (let sId of salon.spectateurs) {
            io.to(sId).emit('recevoirEmoji', data);
        }
    });

    socket.on('demandeSortir', () => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.partie) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;

        let allie = salon.partie.demanderSortie(numeroJoueur);
        let idAllie = Object.keys(salon.joueurs).find(id => salon.joueurs[id] === allie);
        if (idAllie && !idAllie.startsWith('bot-')) {
            io.to(idAllie).emit('questionSortie', numeroJoueur);
        } else if (idAllie && idAllie.startsWith('bot-')) {
            socket.emit('resultatSortie', true); 
        }
    });

    socket.on('reponseSortie', (data) => {
        const salon = getSalonPourSocket(socket.id);
        if (!salon || !salon.partie) return;
        let numeroJoueur = salon.joueurs[socket.id];
        if (!numeroJoueur) return;

        let demandeur = salon.partie.demanderSortie(numeroJoueur);
        let accepte = typeof data === 'object' ? data.accepte : !!data;
        if (!accepte) {
            salon.partie.sortieRefusee[demandeur] = true;
        }
        let idDemandeur = Object.keys(salon.joueurs).find(id => salon.joueurs[id] === demandeur);
        if (idDemandeur && !idDemandeur.startsWith('bot-')) {
            io.to(idDemandeur).emit('resultatSortie', { accepte });
        }
    });

    socket.on('tentativeReconnexion', (token) => {
        if (deconnexionsPendantPartie[token]) {
            let data = deconnexionsPendantPartie[token];
            clearTimeout(data.timeout);
            
            const salon = salons[data.roomId];
            if (salon) {
                salon.joueurs[socket.id] = data.numero;
                joueursDansSalons[socket.id] = data.roomId;
                
                socket.emit('attributionSiege', data.numero);
                diffuserEtatGlobal(salon);
                socket.emit('alerteJeu', 'Reconnexion réussie !');
                envoyerMiseAJourSalon(salon);
            } else {
                socket.emit('alerteJeu', 'Le salon n\'existe plus.');
            }
            delete deconnexionsPendantPartie[token];
        } else {
            socket.emit('alerteJeu', 'Impossible de se reconnecter.');
        }
    });

    socket.on('disconnect', () => {
        console.log(`Déconnexion : ${socket.id}`);
        quitterLeSalon(socket.id);
    });
});

const PORT = process.env.PORT || 3000;
serveur.listen(PORT, () => {
    console.log(`Serveur Canasta démarré sur http://localhost:${PORT}`);
});