/**
 * app principale wyvern
 */

const WyvernApp = {
    //Etat
    userId: null,
    userPseudo: '',
    userEmail: null,
    userCode: '',
    userPhoto: null,
    servers: [],
    currentServerId: null,
    currentChannelId: null,
    currentChannelName: '',
    currentChannelType: 'publique',
    currentDmUserId: null,
    currentDmPseudo: '',
    currentView: 'home',   // 'home' | 'channel' | 'dm'
    typingTimeout: null,
    userSearchTimeout: null,
    knownUsers: new Map(),  // id -> {pseudo, photo_profil}
    dmConversations: new Map(), // id -> {user_id, pseudo, photo_profil, last_message_at}
    currentChannelMembersKeys: null, // [{user_id, pubkey}] pour chiffrement E2E salon

    //init
    async init() {
        //charger l'utilisateur courant
        const me = await this.api('/me');
        if (!me || me.error) {
            window.location.href = '/login';
            return;
        }
        this.userId = me.user_id;
        //restaurer la clé privée E2E depuis sessionStorage
        const storedKey = sessionStorage.getItem('e2e_pk');
        if (storedKey) {
            window.__wyvernPrivateKey = BigInt('0x' + storedKey);
            console.log('[E2E] Clé privée restaurée depuis sessionStorage');
        }
        this.userPseudo = me.pseudo;
        this.userEmail = me.email;
        this.userCode = me.code_16_chiffres;
        this.userPhoto = me.photo_profil;

        this.updateUserBarDisplay();

        //connection websocket
        WyvernSocket.connect();
        //load les serveurs
        await this.loadServers();
        //event listeners
        this.setupEvents();
        //demarrage a la page des dms
        this.selectHome();
    },

    updateUserBarDisplay() {
        document.getElementById('username-display').textContent = this.userPseudo;
        const avatar = document.getElementById('user-avatar');
        avatar.textContent = this.userPseudo.charAt(0).toUpperCase();
        avatar.style.background = this.pseudoColor(this.userPseudo);
    },
    //helper pour l'api
    async api(url, method = 'GET', body = null) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin'
        };
        if (body) opts.body = JSON.stringify(body);
        try {
            const res = await fetch(url, opts);
            return await res.json();
        } catch (err) {
            console.error('API error:', err);
            return { error: 'Erreur réseau' };
        }
    },

// VV Serveurs VV
    async loadServers() {
        const result = await this.api('/api/servers');
        this.servers = Array.isArray(result) ? result : [];
        this.renderServerList();
    },

    renderServerList() {
        const list = document.getElementById('server-list');
        const addBtn = document.getElementById('btn-add-server');

        // Supprimer les anciens serveurs
        list.querySelectorAll('.server-icon.dynamic').forEach(el => el.remove());

        // Ajouter les serveurs
        this.servers.forEach(s => {
            const icon = document.createElement('div');
            icon.className = 'server-icon dynamic';
            if (s.id === this.currentServerId) icon.classList.add('active');
            icon.dataset.id = s.id;
            icon.title = s.nom;
            icon.textContent = s.nom.charAt(0).toUpperCase();
            icon.addEventListener('click', () => this.selectServer(s.id));
            icon.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showServerInfo(s.id);
            });
            list.insertBefore(icon, addBtn);
        });
    },

    async selectServer(serverId) {
        this.currentServerId = serverId;
        this.currentView = 'channel';
        this.currentDmUserId = null;
        //highlight
        document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
        const icon = document.querySelector(`.server-icon[data-id="${serverId}"]`);
        if (icon) icon.classList.add('active');
        //titre sidebar
        const server = this.servers.find(s => s.id === serverId);
        document.getElementById('sidebar-title').textContent = server ? server.nom : '...';
        document.getElementById('btn-new-dm').style.display = 'none';
        //fermer les panels
        this.closePanels();
        //chargement des salons
        await this.loadChannels(serverId);
    },
    selectHome() {
        this.currentServerId = null;
        this.currentView = 'home';
        this.currentChannelId = null;
        this.currentDmUserId = null;

        WyvernSocket.leaveCurrentChannel();
        document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
        document.querySelector('.home-icon').classList.add('active');
        document.getElementById('sidebar-title').textContent = 'Messages privés';
        document.getElementById('btn-new-dm').style.display = 'inline-block';
        document.getElementById('message-input-container').style.display = 'none';

        this.closePanels();
        this.hideHeaderActions();
        this.showWelcomeScreen();

        //chargement liste des conversations DM
        this.loadDMList();
    },

    async showServerInfo(serverId) {
        const server = this.servers.find(s => s.id === serverId);
        if (!server) return;
        document.getElementById('info-server-name').textContent = server.nom;
        document.getElementById('info-invite-code').textContent = server.code_invitation || '(admin uniquement)';
        document.getElementById('info-role').textContent = server.is_owner ? 'Propriétaire' : server.role;
        document.getElementById('btn-delete-server').style.display = server.is_owner ? 'inline-block' : 'none';

        //bouton copier
        document.getElementById('btn-copy-invite').onclick = () => {
            if (server.code_invitation) {
                navigator.clipboard.writeText(server.code_invitation);
                document.getElementById('btn-copy-invite').textContent = '✅';
                setTimeout(() => {
                    document.getElementById('btn-copy-invite').textContent = '📋';
                }, 1500);
            }
        };

        //bouton supprimer
        document.getElementById('btn-delete-server').onclick = async () => {
            if (confirm(`Supprimer le serveur "${server.nom}" ? Cette action est irréversible.`)) {
                await this.api(`/api/servers/${serverId}`, 'DELETE');
                this.closeModals();
                this.selectHome();
                await this.loadServers();
            }
        };

        this.openModal('modal-server-info');
    },

// VV Salons VV

    async loadChannels(serverId) {
        const channels = await this.api(`/api/servers/${serverId}/channels`);
        this.renderChannelList(Array.isArray(channels) ? channels : []);
        //sélectionner le premier salon automatiquement
        if (Array.isArray(channels) && channels.length > 0) {
            this.selectChannel(channels[0].id, channels[0].nom, channels[0].type);
        } else {
            this.showWelcomeScreen();
            document.getElementById('message-input-container').style.display = 'none';
        }
    },

    renderChannelList(channels) {
        const list = document.getElementById('channel-list');
        list.innerHTML = '';
        //bouton ajouter un salon (si admin)
        const server = this.servers.find(s => s.id === this.currentServerId);
        if (server && (server.role === 'admin' || server.is_owner)) {
            const addBtn = document.createElement('div');
            addBtn.className = 'channel-add-btn';
            addBtn.textContent = '+ Créer un salon';
            addBtn.addEventListener('click', () => this.openModal('modal-create-channel'));
            list.appendChild(addBtn);
        }

        const isAdmin = server && (server.role === 'admin' || server.is_owner);

        channels.forEach(c => {
            // Masquer les salons privés aux utilisateurs normaux
            if (c.type === 'prive' && !isAdmin) return;

            const item = document.createElement('div');
            item.className = 'channel-item';
            item.dataset.id = c.id;

            const icon = c.type === 'prive' ? '🔒' : '#';
            item.innerHTML = `<span class="channel-icon">${icon}</span> ${this.escapeHtml(c.nom)}`;

            item.addEventListener('click', () => this.selectChannel(c.id, c.nom, c.type));
            list.appendChild(item);
        });
    },

    async selectChannel(channelId, channelName, channelType) {
        this.currentChannelId = channelId;
        this.currentChannelName = channelName;
        this.currentChannelType = channelType || 'publique';
        this.currentDmUserId = null;
        this.currentView = 'channel';
        //fermer les panels
        this.closePanels();

        //highlight
        document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
        const item = document.querySelector(`.channel-item[data-id="${channelId}"]`);
        if (item) item.classList.add('active');

        //header
        document.getElementById('chat-header-icon').textContent = channelType === 'prive' ? '🔒' : '#';
        document.getElementById('chat-header-name').textContent = channelName;
        this.showHeaderActions(true);

        //afficher input
        document.getElementById('message-input-container').style.display = 'block';
        document.getElementById('message-input').placeholder = `Envoyer un message dans #${channelName}`;
        document.getElementById('message-input').focus();

        //rejoindre la room WebSocket
        WyvernSocket.joinChannel(channelId);

        //charger les messages
        await this.loadMessages(channelId);
    },

// VV Messages VV
    async loadMessages(channelId) {
        const result = await this.api(`/api/channels/${channelId}/messages?limit=100`);
        const messages = Array.isArray(result) ? result : [];

        //charger les clés des membres pour le déchiffrement E2E
        if (window.__wyvernPrivateKey && this.currentServerId) {
            try {
                const keysData = await this.api(`/api/servers/${this.currentServerId}/members_keys`);
                if (Array.isArray(keysData)) {
                    this.currentChannelMembersKeys = keysData.map(k => ({
                        user_id: k.user_id,
                        pubkey: WyvernCrypto.deserializePoint(k.cle_publique)
                    }));
                }
            } catch (err) {
                console.warn('[E2E] Impossible de charger les clés membres:', err);
                this.currentChannelMembersKeys = null;
            }
        }

        const area = document.getElementById('message-area');
        area.innerHTML = '';

        if (messages.length === 0) {
            area.innerHTML = '<div class="empty-channel"><p>Aucun message. Lancez la conversation !</p></div>';
        } else {
            for (const m of messages) {
                //déchiffrer le contenu pour détecter les sondages
                const contenuClair = this.decryptContent(m);
                if (contenuClair && contenuClair.startsWith('[SONDAGE]')) {
                    // Récupérer les données complètes du sondage depuis l'API
                    const pollData = await this.api(`/api/messages/${m.id}/poll`);
                    if (pollData && !pollData.error) {
                        this.appendPoll(pollData, false);
                    } else {
                        // Fallback : afficher comme message normal si le poll est introuvable
                        this.appendMessage(m, false);
                    }
                } else {
                    this.appendMessage(m, false);
                }
            }
        }
        this.scrollToBottom();
    },

    async loadDMMessages(otherUserId) {
        const result = await this.api(`/api/dm/${otherUserId}/messages`);
        const messages = Array.isArray(result) ? result : [];
        const area = document.getElementById('message-area');
        area.innerHTML = '';

        if (messages.length === 0) {
            area.innerHTML = '<div class="empty-channel"><p>Aucun message. Dites bonjour !</p></div>';
        } else {
            messages.forEach(m => this.appendMessage(m, false));
        }
        this.scrollToBottom();
    },

    appendMessage(msg, scroll = true) {
        const area = document.getElementById('message-area');
        // Retirer l'écran de bienvenue ou le message vide
        const welcome = area.querySelector('.welcome-screen, .empty-channel');
        if (welcome) welcome.remove();

        const div = document.createElement('div');
        div.className = 'message';
        if (msg.est_epingle) div.classList.add('message-pinned');
        div.dataset.id = msg.id;

        const initiale = msg.auteur_pseudo ? msg.auteur_pseudo.charAt(0).toUpperCase() : '?';
        const time = this.formatTime(msg.horodatage);
        const isOwn = msg.auteur_id === this.userId;
        const isChannel = this.currentView === 'channel';
        const server = this.servers.find(s => s.id === this.currentServerId);
        const isAdmin = server && (server.role === 'admin' || server.is_owner);

        div.innerHTML = `
            <div class="message-avatar" style="background: ${this.pseudoColor(msg.auteur_pseudo)}">${this.escapeHtml(initiale)}</div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author" style="color: ${this.pseudoColor(msg.auteur_pseudo)}">${this.escapeHtml(msg.auteur_pseudo)}</span>
                    <span class="message-time">${time}</span>
                    ${msg.est_epingle ? '<span class="pin-badge" title="Épinglé">📌</span>' : ''}
                </div>
                <div class="message-text">${this.escapeHtml(this.decryptContent(msg))}</div>
            </div>
            <div class="message-actions">
                ${isChannel && isAdmin ? `<button class="msg-action-btn" data-action="pin" title="${msg.est_epingle ? 'Désépingler' : 'Épingler'}">📌</button>` : ''}
                ${isOwn ? '<button class="msg-action-btn" data-action="edit" title="Modifier">✏️</button>' : ''}
                ${(isOwn || (isChannel && isAdmin)) ? '<button class="msg-action-btn" data-action="delete" title="Supprimer">🗑️</button>' : ''}
            </div>
        `;

        // Actions sur les messages
        div.querySelectorAll('.msg-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                if (action === 'delete') this.deleteMessage(msg.id, div);
                if (action === 'edit') this.editMessage(msg.id, div);
                if (action === 'pin') this.togglePin(msg.id, div);
            });
        });

        area.appendChild(div);
        if (scroll) this.scrollToBottom();
    },

    /**déchiffre le contenu d'un message si E2E actif, sinon retourne le texte brut*/
    decryptContent(msg) {
        if (!window.__wyvernPrivateKey || !msg.iv_chiffrement || !msg.cle_symetrique_chiffree) {
            return msg.contenu_chiffre; //pas chiffré E2E
        }
        try {
            //salon : cle_symetrique_chiffree est un JSON {user_id: "C1|C2"}
            //dm : cle_symetrique_chiffree est directement "C1|C2"
            let keys = msg.cle_symetrique_chiffree;
            if (typeof keys === 'string' && keys.startsWith('{')) {
                keys = JSON.parse(keys);
            }

            if (typeof keys === 'object' && !Array.isArray(keys)) {
                //message de salon — déchiffrer avec notre user_id
                return WyvernCrypto.decryptChannelMessage({
                    ciphertext: msg.contenu_chiffre,
                    iv: msg.iv_chiffrement,
                    encryptedKeys: keys
                }, this.userId, window.__wyvernPrivateKey);
            } else {
                //message DM — cle_symetrique_chiffree = "C1hex|C2hex"
                const parts = msg.cle_symetrique_chiffree.split('|');
                if (parts.length === 2) {
                    return WyvernCrypto.decryptMessage(
                        msg.contenu_chiffre, parts[0], parts[1],
                        msg.iv_chiffrement, window.__wyvernPrivateKey
                    );
                }
            }
        } catch (err) {
            console.warn('[E2E] Déchiffrement échoué:', err.message);
        }
        return '[Message chiffré — déchiffrement impossible]';
    },

    async deleteMessage(msgId, element) {
        if (!confirm('Supprimer ce message ?')) return;
        const res = await this.api(`/api/messages/${msgId}`, 'DELETE');
        if (!res.error) {
            element.remove();
        } else {
            alert('Erreur : ' + res.error);
        }
    },

    editMessage(msgId, element) {
        const textEl = element.querySelector('.message-text');
        const oldText = textEl.textContent;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'edit-input';
        input.value = oldText;
        textEl.replaceWith(input);
        input.focus();
        input.select();

        const save = async () => {
            const newText = input.value.trim();
            const newEl = document.createElement('div');
            newEl.className = 'message-text';
            if (newText && newText !== oldText) {
                await this.api(`/api/messages/${msgId}`, 'PUT', { contenu_chiffre: newText });
                newEl.textContent = newText;
            } else {
                newEl.textContent = oldText;
            }
            input.replaceWith(newEl);
        };

        let saved = false;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                saved = true;
                save();
            }
            if (e.key === 'Escape') {
                saved = true;
                const newEl = document.createElement('div');
                newEl.className = 'message-text';
                newEl.textContent = oldText;
                input.replaceWith(newEl);
            }
        });
        input.addEventListener('blur', () => {
            if (!saved) save();
        });
    },

    async togglePin(msgId, element) {
        const res = await this.api(`/api/messages/${msgId}/pin`, 'POST');
        if (!res.error) {
            // Recharger les messages pour refléter le changement
            if (this.currentChannelId) {
                await this.loadMessages(this.currentChannelId);
            }
        } else {
            alert('Erreur : ' + res.error);
        }
    },

    // ══════════════════════════════════════════
    //  DMs
    // ══════════════════════════════════════════

    async loadDMList() {
    const result = await this.api('/api/dms');
    const conversations = Array.isArray(result) ? result : [];
    this.dmConversations = new Map();

    conversations.forEach(dm => {
        this.dmConversations.set(dm.user_id, dm);
        this.knownUsers.set(dm.user_id, { pseudo: dm.pseudo, photo_profil: dm.photo_profil });
    });

    this.renderDMList();
    },

    renderDMList() {
    const list = document.getElementById('channel-list');
    list.innerHTML = '';

    if (this.dmConversations.size === 0) {
        list.innerHTML = '<p class="dm-hint">Cliquez sur ✉️ pour démarrer une conversation.</p>';
        return;
    }

    const title = document.createElement('div');
    title.className = 'channel-section-title';
    title.textContent = 'Conversations';
    list.appendChild(title);

    const conversations = Array.from(this.dmConversations.values())
        .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));

    conversations.forEach((dm) => {
        const item = document.createElement('div');
        item.className = 'channel-item dm-item';
        item.dataset.userId = dm.user_id;
        item.innerHTML = `<span class="dm-avatar" style="background:${this.pseudoColor(dm.pseudo)}">${dm.pseudo.charAt(0).toUpperCase()}</span> ${this.escapeHtml(dm.pseudo)}`;
        item.addEventListener('click', () => this.selectDM(dm.user_id, dm.pseudo));
        if (dm.user_id === this.currentDmUserId) item.classList.add('active');
        list.appendChild(item);
        });
    },

    async selectDM(otherUserId, otherPseudo) {
        this.currentView = 'dm';
        this.currentDmUserId = otherUserId;
        this.currentDmPseudo = otherPseudo;
        this.currentChannelId = null;

        WyvernSocket.leaveCurrentChannel();
        this.closePanels();

        document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
        const item = document.querySelector(`.dm-item[data-user-id="${otherUserId}"]`);
        if (item) item.classList.add('active');

        document.getElementById('chat-header-icon').textContent = '💬';
        document.getElementById('chat-header-name').textContent = otherPseudo;
        this.hideHeaderActions();
        document.getElementById('message-input-container').style.display = 'block';
        document.getElementById('message-input').placeholder = `Message à ${otherPseudo}`;
        document.getElementById('message-input').focus();
        this.ensureDMConversation(otherUserId, otherPseudo);
        await this.loadDMMessages(otherUserId);
    },

    ensureDMConversation(userId, pseudo, photoProfil = null, lastMessageAt = null) {
    if (!userId || !pseudo) return;

    const existing = this.dmConversations.get(userId) || {};
    const conversation = {
        user_id: userId,
        pseudo: pseudo || existing.pseudo || 'Utilisateur',
        photo_profil: photoProfil ?? existing.photo_profil ?? null,
        last_message_at: lastMessageAt || existing.last_message_at || new Date().toISOString()
        };

    this.dmConversations.set(userId, conversation);
    this.knownUsers.set(userId, {
        pseudo: conversation.pseudo,
        photo_profil: conversation.photo_profil
        });

    if (this.currentView === 'home' || this.currentView === 'dm') {
        this.renderDMList();
        }
    },

    promoteDMConversation(userId, pseudo = null, photoProfil = null, lastMessageAt = null) {
    const known = this.knownUsers.get(userId) || {};
    this.ensureDMConversation(
        userId,
        pseudo || known.pseudo,
        photoProfil ?? known.photo_profil ?? null,
        lastMessageAt || new Date().toISOString()
        );
    },

    /**recherche d'utilisateurs dans le modal "Nouvelle conversation". */
    async searchUsers(query) {
        const resultsEl = document.getElementById('user-search-results');
        if (!query || query.length < 2) {
            resultsEl.innerHTML = '<p class="search-hint">Tapez au moins 2 caractères pour chercher.</p>';
            return;
        }

        resultsEl.innerHTML = '<p class="search-hint">Recherche…</p>';
        const result = await this.api(`/api/users/search?q=${encodeURIComponent(query)}`);
        const users = Array.isArray(result) ? result : [];

        if (users.length === 0) {
            resultsEl.innerHTML = '<p class="search-hint">Aucun utilisateur trouvé.</p>';
            return;
        }

        resultsEl.innerHTML = '';
        users.forEach(u => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.innerHTML = `
                <div class="dm-avatar" style="background:${this.pseudoColor(u.pseudo)}">${u.pseudo.charAt(0).toUpperCase()}</div>
                <span class="result-pseudo">${this.escapeHtml(u.pseudo)}</span>
                <button class="btn btn-primary btn-small">Discuter</button>
            `;
            item.querySelector('button').addEventListener('click', () => {
                this.knownUsers.set(u.id, { pseudo: u.pseudo, photo_profil: u.photo_profil });
                this.ensureDMConversation(u.id, u.pseudo, u.photo_profil);
                this.closeModals();
                // Basculer en mode home et ouvrir la DM
                this.selectHome();
                // Ajouter l'utilisateur à la liste si absent
                setTimeout(() => this.selectDM(u.id, u.pseudo), 200);
            });
            resultsEl.appendChild(item);
        });
    },

    // VV Envoi messages VV
    async sendCurrentMessage() {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        if (!text) return;

        //intercepter les commandes slash avant l'envoi
        if (await WyvernCommands.tryExecute(text)) {
            input.value = '';
            input.focus();
            return;
        }

        if (this.currentView === 'channel' && this.currentChannelId) {
            await WyvernSocket.sendMessage(text, this.currentChannelId);
        } else if (this.currentView === 'dm' && this.currentDmUserId) {
            await WyvernSocket.sendDM(text, this.currentDmUserId);
        }
        input.value = '';
        input.focus();
    },

// VV Panels VV
    async toggleMembersPanel() {
        const panel = document.getElementById('members-panel');
        const pinned = document.getElementById('pinned-panel');
        pinned.style.display = 'none';

        if (panel.style.display === 'none' && this.currentServerId) {
            panel.style.display = 'flex';
            const members = await this.api(`/api/servers/${this.currentServerId}/members`);
            const list = document.getElementById('members-list');
            list.innerHTML = '';
            if (Array.isArray(members)) {
                members.forEach(m => {
                    const item = document.createElement('div');
                    item.className = 'member-item';
                    item.innerHTML = `
                        <div class="member-avatar" style="background:${this.pseudoColor(m.pseudo)}">${m.pseudo.charAt(0).toUpperCase()}</div>
                        <div class="member-info">
                            <span class="member-name">${this.escapeHtml(m.pseudo)}</span>
                            <span class="member-role ${m.role}">${m.role}</span>
                        </div>
                    `;
                    list.appendChild(item);
                });
            }
        } else {
            panel.style.display = 'none';
        }
    },

    async togglePinnedPanel() {
        const panel = document.getElementById('pinned-panel');
        const members = document.getElementById('members-panel');
        members.style.display = 'none';

        if (panel.style.display === 'none' && this.currentChannelId) {
            panel.style.display = 'flex';
            const pinned = await this.api(`/api/channels/${this.currentChannelId}/pinned`);
            const list = document.getElementById('pinned-list');
            list.innerHTML = '';
            if (Array.isArray(pinned) && pinned.length === 0) {
                list.innerHTML = '<p class="no-pinned">Aucun message épinglé.</p>';
            } else if (Array.isArray(pinned)) {
                pinned.forEach(m => {
                    const item = document.createElement('div');
                    item.className = 'pinned-item';
                    item.innerHTML = `
                        <div class="pinned-author">${this.escapeHtml(m.auteur_pseudo)}</div>
                        <div class="pinned-text">${this.escapeHtml(this.decryptContent(m))}</div>
                        <div class="pinned-time">${this.formatTime(m.horodatage)}</div>
                    `;
                    list.appendChild(item);
                });
            }
        } else {
            panel.style.display = 'none';
        }
    },

    closePanels() {
        document.getElementById('members-panel').style.display = 'none';
        document.getElementById('pinned-panel').style.display = 'none';
    },

//VV recherche messages coté client VV
    async searchMessages() {
        const query = document.getElementById('search-input').value.trim();
        if (!query || !this.currentChannelId) return;

        const result = await this.api(`/api/channels/${this.currentChannelId}/search?q=${encodeURIComponent(query)}`);
        const results = Array.isArray(result) ? result : [];
        const area = document.getElementById('message-area');
        area.innerHTML = `<div class="search-results-header">
            <span>Résultats pour "<strong>${this.escapeHtml(query)}</strong>" (${results.length})</span>
            <button class="btn-back-to-chat" id="btn-back-chat">← Retour au salon</button>
        </div>`;

        document.getElementById('btn-back-chat').addEventListener('click', () => {
            this.loadMessages(this.currentChannelId);
        });

        if (results.length === 0) {
            area.innerHTML += '<p class="no-results">Aucun résultat.</p>';
        } else {
            results.forEach(m => this.appendMessage(m, false));
        }
    },
// VV indicateur "X en train d'ecrire" VV
    showTypingIndicator(pseudo) {
        if (pseudo === this.userPseudo) return;
        const indicator = document.getElementById('typing-indicator');
        document.getElementById('typing-user').textContent = pseudo;
        indicator.style.display = 'block';

        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            indicator.style.display = 'none';
        }, 3000);
    },

    //param. profil
    openSettings() {
        //remplir le modal avec les valeurs actuelles
        document.getElementById('settings-code').textContent = this.userCode || '';
        document.getElementById('settings-pseudo').value = this.userPseudo;
        document.getElementById('settings-email').value = this.userEmail || '';
        document.getElementById('settings-photo').value = this.userPhoto || '';
        document.getElementById('settings-current-password').value = '';
        document.getElementById('settings-new-password').value = '';
        document.getElementById('error-settings').textContent = '';
        document.getElementById('success-settings').textContent = '';
        this.openModal('modal-settings');
    },

    async saveSettings() {
        const errorEl = document.getElementById('error-settings');
        const successEl = document.getElementById('success-settings');
        errorEl.textContent = '';
        successEl.textContent = '';

        const body = {};

        // Pseudo
        const newPseudo = document.getElementById('settings-pseudo').value.trim();
        if (newPseudo !== this.userPseudo) {
            body.pseudo = newPseudo;
        }

        // Email
        const newEmail = document.getElementById('settings-email').value.trim();
        if (newEmail !== (this.userEmail || '')) {
            body.email = newEmail;
        }

        // Photo
        const newPhoto = document.getElementById('settings-photo').value.trim();
        if (newPhoto !== (this.userPhoto || '')) {
            body.photo_profil = newPhoto;
        }

        // Mot de passe
        const newPassword = document.getElementById('settings-new-password').value;
        const currentPassword = document.getElementById('settings-current-password').value;
        if (newPassword) {
            if (!currentPassword) {
                errorEl.textContent = 'Mot de passe actuel requis pour changer le mot de passe.';
                return;
            }
            body.new_password = newPassword;
            body.current_password = currentPassword;
        }

        if (Object.keys(body).length === 0) {
            errorEl.textContent = 'Aucune modification à enregistrer.';
            return;
        }

        const btn = document.getElementById('btn-save-settings');
        btn.disabled = true;
        btn.textContent = 'Enregistrement...';

        const res = await this.api('/api/users/me', 'PUT', body);

        btn.disabled = false;
        btn.textContent = 'Enregistrer';

        if (res.error) {
            errorEl.textContent = res.error;
            return;
        }

        // Mettre à jour l'état local
        this.userPseudo = res.pseudo;
        this.userEmail = res.email;
        this.userPhoto = res.photo_profil;
        this.updateUserBarDisplay();

        successEl.textContent = 'Profil mis à jour avec succès !';

        // Vider les champs mot de passe
        document.getElementById('settings-current-password').value = '';
        document.getElementById('settings-new-password').value = '';

        // Fermer automatiquement après 1.5s
        setTimeout(() => this.closeModals(), 1500);
    },
    //aides UI
    showHeaderActions(isChannel) {
        document.getElementById('btn-pinned').style.display = isChannel ? 'inline-block' : 'none';
        document.getElementById('btn-members').style.display = this.currentServerId ? 'inline-block' : 'none';
        document.getElementById('search-input').style.display = isChannel ? 'inline-block' : 'none';
    },
    hideHeaderActions() {
        document.getElementById('btn-pinned').style.display = 'none';
        document.getElementById('btn-members').style.display = 'none';
        document.getElementById('search-input').style.display = 'none';
    },

//VV event listeners VV
    setupEvents() {
        //home
        document.querySelector('.home-icon').addEventListener('click', () => this.selectHome());
        //créer serveur
        document.getElementById('btn-add-server').addEventListener('click', () => this.openModal('modal-create-server'));
        document.getElementById('btn-confirm-create-server').addEventListener('click', async () => {
            const nom = document.getElementById('input-server-name').value.trim();
            if (!nom) { document.getElementById('error-create-server').textContent = 'Nom requis'; return; }
            const res = await this.api('/api/servers', 'POST', { nom });
            if (res.error) { document.getElementById('error-create-server').textContent = res.error; return; }
            this.closeModals();
            await this.loadServers();
            this.selectServer(res.server_id);
        });

        //rejoindre serveur
        document.getElementById('btn-join-server').addEventListener('click', () => this.openModal('modal-join-server'));
        document.getElementById('btn-confirm-join-server').addEventListener('click', async () => {
            const code = document.getElementById('input-invite-code').value.trim();
            if (!code) { document.getElementById('error-join-server').textContent = 'Code requis'; return; }
            const res = await this.api('/api/servers/join', 'POST', { code_invitation: code });
            if (res.error) { document.getElementById('error-join-server').textContent = res.error; return; }
            this.closeModals();
            await this.loadServers();
            if (res.server_id) this.selectServer(res.server_id);
        });

        //créer salon
        document.getElementById('btn-confirm-create-channel').addEventListener('click', async () => {
            const nom = document.getElementById('input-channel-name').value.trim();
            const type = document.getElementById('input-channel-type').value;
            if (!nom) { document.getElementById('error-create-channel').textContent = 'Nom requis'; return; }
            const res = await this.api(`/api/servers/${this.currentServerId}/channels`, 'POST', { nom, type });
            if (res.error) { document.getElementById('error-create-channel').textContent = res.error; return; }
            this.closeModals();
            await this.loadChannels(this.currentServerId);
        });

        //envoyer message
        document.getElementById('btn-send').addEventListener('click', () => this.sendCurrentMessage());
        document.getElementById('message-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.sendCurrentMessage();
            } else {
                // Typing indicator
                if (this.currentChannelId) {
                    WyvernSocket.sendTyping(this.currentChannelId);
                }
            }
        });

        //panels
        document.getElementById('btn-members').addEventListener('click', () => this.toggleMembersPanel());
        document.getElementById('btn-close-members').addEventListener('click', () => {
            document.getElementById('members-panel').style.display = 'none';
        });
        document.getElementById('btn-pinned').addEventListener('click', () => this.togglePinnedPanel());
        document.getElementById('btn-close-pinned').addEventListener('click', () => {
            document.getElementById('pinned-panel').style.display = 'none';
        });
        //recherche
        document.getElementById('search-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.searchMessages();
        });

        //logout
        document.getElementById('btn-logout').addEventListener('click', async () => {
            await this.api('/logout', 'POST');
            sessionStorage.removeItem('e2e_pk');
            window.location.href = '/login';
        });

        // bouton sondage
        document.getElementById('btn-poll').addEventListener('click', () => {
            if (!this.currentChannelId) return;
            document.getElementById('poll-question').value = '';
            document.getElementById('error-create-poll').textContent = '';
            const container = document.getElementById('poll-options-container');
            container.innerHTML = `
                <div class="form-group"><label>Option 1</label><input type="text" class="poll-option-input" placeholder="Option 1" maxlength="100"/></div>
                <div class="form-group"><label>Option 2</label><input type="text" class="poll-option-input" placeholder="Option 2" maxlength="100"/></div>`;
            this.openModal('modal-create-poll');
        });

        document.getElementById('btn-add-poll-option').addEventListener('click', () => {
            const container = document.getElementById('poll-options-container');
            const count = container.querySelectorAll('.poll-option-input').length + 1;
            if (count > 5) return;
            const div = document.createElement('div');
            div.className = 'form-group';
            div.innerHTML = `<label>Option ${count}</label><input type="text" class="poll-option-input" placeholder="Option ${count}" maxlength="100"/>`;
            container.appendChild(div);
        });

        document.getElementById('btn-confirm-create-poll').addEventListener('click', async () => {
            const question = document.getElementById('poll-question').value.trim();
            const options = Array.from(document.querySelectorAll('.poll-option-input'))
                .map(i => i.value.trim()).filter(Boolean);
            if (!question) { document.getElementById('error-create-poll').textContent = 'Question requise'; return; }
            if (options.length < 2) { document.getElementById('error-create-poll').textContent = 'Au moins 2 options requises'; return; }
            const res = await this.api(`/api/channels/${this.currentChannelId}/polls`, 'POST', { question, options });
            if (res.error) { document.getElementById('error-create-poll').textContent = res.error; return; }
            this.closeModals();
            // le sondage apparaît via WebSocket new_poll
        });

        //fermer les modals (bouton Annuler/click sur overlay)
        //param. profil
        document.getElementById('user-info-clickable').addEventListener('click', () => this.openSettings());
        document.getElementById('btn-save-settings').addEventListener('click', () => this.saveSettings());
        document.getElementById('btn-copy-code').addEventListener('click', () => {
            navigator.clipboard.writeText(this.userCode);
            const btn = document.getElementById('btn-copy-code');
            btn.textContent = '✅';
            setTimeout(() => { btn.textContent = '📋'; }, 1500);
        });

        //nouvelle conversation (recherche utilisateur)
        document.getElementById('btn-new-dm').addEventListener('click', () => this.openModal('modal-new-dm'));
        document.getElementById('input-search-user').addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearTimeout(this.userSearchTimeout);
            this.userSearchTimeout = setTimeout(() => this.searchUsers(query), 250);
        });

        //fermer les modals (bouton Annuler / clic sur overlay)
        document.querySelectorAll('.modal-cancel').forEach(btn => {
            btn.addEventListener('click', () => this.closeModals());
        });
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) this.closeModals();
            });
        });

        //entree dans les modals
        ['input-server-name', 'input-invite-code', 'input-channel-name'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        const modal = el.closest('.modal-overlay');
                        const btn = modal.querySelector('.btn-primary');
                        if (btn) btn.click();
                    }
                });
            }
        });
    },

//VV Utils VV
    openModal(id) {
        const modal = document.getElementById(id);
        modal.classList.add('active');

        //ne pas vider les inputs du modal settings ou new-dm (ils sont remplis par openSettings / searchUsers)
        if (id !== 'modal-settings' && id !== 'modal-new-dm') {
            modal.querySelectorAll('input').forEach(i => i.value = '');
        }
        modal.querySelectorAll('.modal-error, .modal-success').forEach(e => e.textContent = '');

        const firstInput = modal.querySelector('input:not([type="password"])') || modal.querySelector('input');
        if (firstInput) setTimeout(() => firstInput.focus(), 100);

        if (id === 'modal-new-dm') {
            document.getElementById('user-search-results').innerHTML = '<p class="search-hint">Tapez au moins 2 caractères pour chercher.</p>';
        }
    },
    closeModals() {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    },
    showWelcomeScreen() {
        const area = document.getElementById('message-area');
        area.innerHTML = `
            <div class="welcome-screen">
                <div class="welcome-logo">🐉</div>
                <h2>Bienvenue sur Wyvern</h2>
                <p>Sélectionnez un serveur à gauche, créez-en un nouveau, ou commencez une conversation privée.</p>
            </div>
        `;
        document.getElementById('chat-header-name').textContent = 'Accueil';
        document.getElementById('chat-header-icon').textContent = '';
    },
    scrollToBottom() {
        const area = document.getElementById('message-area');
        area.scrollTop = area.scrollHeight;
    },
    formatTime(iso) {
        const d = new Date(iso);
        const today = new Date();
        const isToday = d.toDateString() === today.toDateString();
        const time = d.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
        if (isToday) return `Aujourd'hui ${time}`;
        return `${d.toLocaleDateString('fr-CH')} ${time}`;
    },
    escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    },
    /** génération de qq couleurs a partir de pseudo*/
    pseudoColor(pseudo) {
        if (!pseudo) return '#89b4fa';
        const colors = ['#f38ba8', '#fab387', '#f9e2af', '#a6e3a1', '#94e2d5', '#89b4fa', '#cba6f7', '#f5c2e7'];
        let hash = 0;
        for (let i = 0; i < pseudo.length; i++) {
            hash = pseudo.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    },

//  SONDAGES
    buildPollHTML(poll) {
        const optionsHTML = poll.options.map(opt => {
            const voted = opt.id === poll.user_vote;
            return `
            <div>
                <button class="poll-option-btn ${voted ? 'voted' : ''}" data-option-id="${opt.id}">
                    <span>${this.escapeHtml(opt.texte)}</span>
                    <span class="poll-option-count">${opt.votes} vote${opt.votes !== 1 ? 's' : ''} (${opt.percent}%)</span>
                </button>
                <div class="poll-progress-bar">
                    <div class="poll-progress-fill" style="width:${opt.percent}%"></div>
                </div>
            </div>`;
        }).join('');

        const unvoteLink = poll.user_vote
            ? ` · <a href="#" class="poll-unvote" data-poll-id="${poll.id}">Retirer mon vote</a>`
            : '';

        return `
        <div class="poll-card" data-poll-id="${poll.id}">
            <div class="poll-question">📊 ${this.escapeHtml(poll.question)}</div>
            <div class="poll-options">${optionsHTML}</div>
            <div class="poll-footer">${poll.total_votes} vote${poll.total_votes !== 1 ? 's' : ''} au total${unvoteLink}</div>
        </div>`;
    },

    attachPollEvents(container, pollId) {
        container.querySelectorAll('.poll-option-btn').forEach(btn => {
            btn.addEventListener('click', () => this.votePoll(pollId, parseInt(btn.dataset.optionId)));
        });
        const unvote = container.querySelector('.poll-unvote');
        if (unvote) {
            unvote.addEventListener('click', async (e) => {
                e.preventDefault();
                await this.unvotePoll(pollId);
            });
        }
    },

    async votePoll(pollId, optionId) {
        const res = await this.api(`/api/polls/${pollId}/vote`, 'POST', { option_id: optionId });
        if (res.error) { alert('Erreur : ' + res.error); return; }
        this.refreshPollInDOM(res);
    },

    async unvotePoll(pollId) {
        const res = await this.api(`/api/polls/${pollId}/vote`, 'DELETE');
        if (res.error) { alert('Erreur : ' + res.error); return; }
        this.refreshPollInDOM(res);
    },

    refreshPollInDOM(pollData) {
        const area = document.getElementById('message-area');
        const card = area.querySelector(`.poll-card[data-poll-id="${pollData.id}"]`);
        if (card) {
            card.outerHTML = this.buildPollHTML(pollData);
            // re-sélectionner après remplacement
            const newCard = area.querySelector(`.poll-card[data-poll-id="${pollData.id}"]`);
            if (newCard) this.attachPollEvents(newCard.parentElement, pollData.id);
        }
    },

    appendPoll(pollData, scroll = true) {
        const area = document.getElementById('message-area');
        const welcome = area.querySelector('.welcome-screen, .empty-channel');
        if (welcome) welcome.remove();

        const wrapper = document.createElement('div');
        wrapper.className = 'message';
        const initiale = (pollData.auteur_pseudo || '?').charAt(0).toUpperCase();
        const time = this.formatTime(pollData.horodatage);

        wrapper.innerHTML = `
            <div class="message-avatar" style="background:${this.pseudoColor(pollData.auteur_pseudo)}">${this.escapeHtml(initiale)}</div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-author" style="color:${this.pseudoColor(pollData.auteur_pseudo)}">${this.escapeHtml(pollData.auteur_pseudo)}</span>
                    <span class="message-time">${time}</span>
                </div>
                ${this.buildPollHTML(pollData)}
            </div>`;

        this.attachPollEvents(wrapper, pollData.id);
        area.appendChild(wrapper);
        if (scroll) this.scrollToBottom();
    },

};
//lancer l'application
document.addEventListener('DOMContentLoaded', () => WyvernApp.init());