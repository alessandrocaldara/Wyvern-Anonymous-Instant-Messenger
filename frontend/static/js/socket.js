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
            if (WyvernApp.currentView === 'dm') {
                const otherId = msg.auteur_id === WyvernApp.userId
                    ? msg.destinataire_id
                    : msg.auteur_id;
                if (otherId === WyvernApp.currentDmUserId) {
                    WyvernApp.appendMessage(msg);
                }
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
    /**envoie message dans un*/
    sendMessage(contenu, channelId) {
        this.socket.emit('send_message', {
            contenu_chiffre: contenu,
            channel_id: channelId
        });
    },
    /**envoi message privé*/
    sendDM(contenu, destinataireId) {
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