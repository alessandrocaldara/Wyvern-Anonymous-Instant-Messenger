/**
 * app principale wyvern
 */

const WyvernApp = {
    //Etat
    userId: null,
    userPseudo: '',
    servers: [],
    currentServerId: null,
    currentChannelId: null,
    currentChannelName: '',
    currentChannelType: 'publique',
    currentDmUserId: null,
    currentView: 'home',   // 'home' | 'channel' | 'dm'
    typingTimeout: null,

    //init
    async init() {
        //charger l'utilisateur courant
        const me = await this.api('/me');
        if (!me || me.error) {
            window.location.href = '/login';
            return;
        }
        this.userId = me.user_id;
        this.userPseudo = me.pseudo;

        //afficher le pseudo dans la barre utilisateur
        document.getElementById('username-display').textContent = me.pseudo;
        const avatar = document.getElementById('user-avatar');
        avatar.textContent = me.pseudo.charAt(0).toUpperCase();
        avatar.style.background = this.pseudoColor(me.pseudo);

        //connection websocket
        WyvernSocket.connect();
        //load les serveurs
        await this.loadServers();
        //event listeners
        this.setupEvents();
        //demarrage a la page des dms
        this.selectHome();
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

        channels.forEach(c => {
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
        const area = document.getElementById('message-area');
        area.innerHTML = '';

        if (messages.length === 0) {
            area.innerHTML = '<div class="empty-channel"><p>Aucun message. Lancez la conversation !</p></div>';
        } else {
            messages.forEach(m => this.appendMessage(m, false));
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
                <div class="message-text">${this.escapeHtml(msg.contenu_chiffre)}</div>
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
        const list = document.getElementById('channel-list');
        list.innerHTML = '<p class="dm-hint">Chargement des utilisateurs…</p>';

        // Charger les utilisateurs avec qui on a des DMs (tous membres de tous les serveurs)
        const allMembers = new Map();
        for (const server of this.servers) {
            const members = await this.api(`/api/servers/${server.id}/members`);
            if (Array.isArray(members)) {
                members.forEach(m => {
                    if (m.user_id !== this.userId) {
                        allMembers.set(m.user_id, m);
                    }
                });
            }
        }

        if (allMembers.size === 0) {
            list.innerHTML = '<p class="dm-hint">Rejoignez un serveur pour voir d\'autres utilisateurs.</p>';
            return;
        }

        list.innerHTML = '<div class="channel-section-title">Utilisateurs</div>';
        allMembers.forEach((m) => {
            const item = document.createElement('div');
            item.className = 'channel-item dm-item';
            item.dataset.userId = m.user_id;
            item.innerHTML = `<span class="dm-avatar" style="background:${this.pseudoColor(m.pseudo)}">${m.pseudo.charAt(0).toUpperCase()}</span> ${this.escapeHtml(m.pseudo)}`;
            item.addEventListener('click', () => this.selectDM(m.user_id, m.pseudo));
            list.appendChild(item);
        });
    },

    async selectDM(otherUserId, otherPseudo) {
        this.currentView = 'dm';
        this.currentDmUserId = otherUserId;
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
        await this.loadDMMessages(otherUserId);
    },

// VV Envoi messages VV
    sendCurrentMessage() {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        if (!text) return;

        if (this.currentView === 'channel' && this.currentChannelId) {
            WyvernSocket.sendMessage(text, this.currentChannelId);
        } else if (this.currentView === 'dm' && this.currentDmUserId) {
            WyvernSocket.sendDM(text, this.currentDmUserId);
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
                        <div class="pinned-text">${this.escapeHtml(m.contenu_chiffre)}</div>
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
            window.location.href = '/login';
        });

        //fermer les modals (bouton Annuler/click sur overlay)
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
        document.getElementById(id).classList.add('active');
        document.getElementById(id).querySelectorAll('input').forEach(i => i.value = '');
        document.getElementById(id).querySelectorAll('.modal-error').forEach(e => e.textContent = '');
        const firstInput = document.getElementById(id).querySelector('input');
        if (firstInput) setTimeout(() => firstInput.focus(), 100);
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
    }
};
//lancer l'application
document.addEventListener('DOMContentLoaded', () => WyvernApp.init());