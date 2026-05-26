/**
 * module websocket wyvern
 */
const WyvernSocket = {
    socket: null,
    currentChannelId: null,
    /**init connexion websocket*/
    connect() {
        this.socket = io({ transports: ['websocket', 'polling'] });
        this.socket.on('connect', () => {
            console.log('[WS] Connecté');
        });

        this.socket.on('disconnect', () => {
            console.log('[WS] Déconnecté');
        });

        this.socket.on('error', (data) => {
            console.error('[WS] Erreur:', data.message);
        });
        //nouveau message dans un salon
        this.socket.on('new_message', (msg) => {
            if (WyvernApp.currentView === 'channel' && msg.channel_id === this.currentChannelId) {
                WyvernApp.appendMessage(msg);
            }
        });
        //nouveau message prive
        this.socket.on('new_dm', (msg) => {
            const otherId = msg.auteur_id === WyvernApp.userId
                ? msg.destinataire_id
                : msg.auteur_id;
            const otherUser = WyvernApp.knownUsers.get(otherId) || {};

            WyvernApp.promoteDMConversation(
                otherId,
                otherUser.pseudo || msg.auteur_pseudo,
                otherUser.photo_profil || null,
                msg.horodatage
            );

            if (WyvernApp.currentView === 'dm' && otherId === WyvernApp.currentDmUserId) {
                WyvernApp.appendMessage(msg);
            }
        });
        //indicateur "X est en train d'écrire"
        this.socket.on('user_typing', (data) => {
            WyvernApp.showTypingIndicator(data.pseudo);
        });

        //confirmation de salon rejoint
        this.socket.on('joined_channel', (data) => {
            console.log('[WS] Rejoint le salon', data.channel_id);
        });

        // nouveau sondage
        this.socket.on('new_poll', (pollData) => {
            if (WyvernApp.currentView === 'channel' && pollData.channel_id === this.currentChannelId) {
                WyvernApp.appendPoll(pollData);
            }
        });

        // mise à jour d'un sondage (vote/dévote)
        this.socket.on('poll_updated', (pollData) => {
            WyvernApp.refreshPollInDOM(pollData);
        });
    },
    /**rejoindre salon confirmation*/
    joinChannel(channelId) {
        if (this.currentChannelId && this.currentChannelId !== channelId) {
            this.socket.emit('leave_channel', { channel_id: this.currentChannelId });
        }
        this.currentChannelId = channelId;
        this.socket.emit('join_channel', { channel_id: channelId });
    },
    /**départ explicite d'un salon*/
    leaveCurrentChannel() {
        if (this.currentChannelId) {
            this.socket.emit('leave_channel', { channel_id: this.currentChannelId });
            this.currentChannelId = null;
        }
    },
    /**envoie message dans un salon (chiffré E2E si clé disponible)*/
    async sendMessage(contenu, channelId) {
        //chiffrement E2E : toujours récupérer les clés fraîches avant chaque envoi
        if (window.__wyvernPrivateKey && WyvernApp.currentServerId) {
            try {
                const keysData = await WyvernApp.api(`/api/servers/${WyvernApp.currentServerId}/members_keys`);
                if (Array.isArray(keysData) && keysData.length > 0) {
                    const membersKeys = keysData.map(k => ({
                        user_id: k.user_id,
                        pubkey: WyvernCrypto.deserializePoint(k.cle_publique)
                    }));
                    WyvernApp.currentChannelMembersKeys = membersKeys;
                    const payload = WyvernCrypto.encryptChannelMessage(contenu, membersKeys);
                    this.socket.emit('send_message', {
                        contenu_chiffre: payload.ciphertext,
                        iv_chiffrement: payload.iv,
                        cle_symetrique_chiffree: JSON.stringify(payload.encryptedKeys),
                        channel_id: channelId
                    });
                    return;
                }
            } catch (err) {
                console.warn('[E2E] Échec chiffrement salon, envoi en clair:', err);
            }
        }
        //fallback sans E2E
        this.socket.emit('send_message', {
            contenu_chiffre: contenu,
            channel_id: channelId
        });
    },
    /**envoi message privé (chiffré E2E si clé disponible)*/
    async sendDM(contenu, destinataireId) {
        if (window.__wyvernPrivateKey) {
            try {
                //récupérer la clé publique du destinataire
                const keyData = await WyvernApp.api(`/api/users/${destinataireId}/pubkey`);
                //récupérer notre propre clé publique
                const myKeyData = await WyvernApp.api(`/api/users/${WyvernApp.userId}/pubkey`);
                if (keyData && keyData.cle_publique && myKeyData && myKeyData.cle_publique) {
                    //chiffrer pour les DEUX parties (comme un salon à 2 membres)
                    const members = [
                        { user_id: destinataireId, pubkey: WyvernCrypto.deserializePoint(keyData.cle_publique) },
                        { user_id: WyvernApp.userId, pubkey: WyvernCrypto.deserializePoint(myKeyData.cle_publique) }
                    ];
                    const encrypted = WyvernCrypto.encryptChannelMessage(contenu, members);
                    this.socket.emit('send_dm', {
                        contenu_chiffre: encrypted.ciphertext,
                        iv_chiffrement: encrypted.iv,
                        cle_symetrique_chiffree: JSON.stringify(encrypted.encryptedKeys),
                        destinataire_id: destinataireId
                    });
                    return;
                }
            } catch (err) {
                console.warn('[E2E] Échec chiffrement DM, envoi en clair:', err);
            }
        }
        //fallback sans E2E
        this.socket.emit('send_dm', {
            contenu_chiffre: contenu,
            destinataire_id: destinataireId
        });
    },
    /**signaler "en train d'écrire"*/
    sendTyping(channelId) {
        if (channelId) {
            this.socket.emit('typing', { channel_id: channelId });
        }
    }
};
