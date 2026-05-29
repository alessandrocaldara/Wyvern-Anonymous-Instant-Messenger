/**
 * module commandes slash wyvern
 * Intercepte les messages commençant par / et exécute des actions de modération.
 */
const WyvernCommands = {
    //unités de durée → secondes
    DURATION_UNITS: {
        s: 1, sec: 1,
        m: 60, min: 60,
        h: 3600, hrs: 3600,
        d: 86400, days: 86400,
        mo: 2592000, mths: 2592000,   // mois = 30 jours
        y: 31536000, yrs: 31536000    // année = 365 jours
    },

    /**point d'entrée : exécute le texte si c'est une commande, retourne true si interceptée*/
    async tryExecute(text) {
        if (!text.startsWith('/')) return false;

        const parsed = this.parse(text);
        if (!parsed) {
            this.feedback('Commande inconnue. Tapez /help pour la liste.', 'error');
            return true;
        }

        const handler = this.handlers[parsed.name];
        if (!handler) {
            this.feedback(`Commande /${parsed.name} inconnue. Tapez /help.`, 'error');
            return true;
        }
        await handler.call(this, parsed.args);
        return true;
    },

    /**parse '/cmd key:value key:"valeur avec espaces"' → {name, args}*/
    parse(text) {
        const match = text.match(/^\/(\w+)\s*(.*)$/s);
        if (!match) return null;
        const name = match[1].toLowerCase();
        const args = {};
        //capture key:"valeur" ou key:valeur
        const re = /(\w+):(?:"([^"]*)"|(\S+))/g;
        let m;
        while ((m = re.exec(match[2])) !== null) {
            args[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
        }
        return { name, args };
    },

    /**parse "5m", "2h", "7d" → secondes, ou null si invalide*/
    parseDuration(str) {
        const m = str.match(/^(\d+)(sec|min|hrs|days|mths|mo|yrs|s|m|h|d|y)$/);
        if (!m) return null;
        return parseInt(m[1], 10) * this.DURATION_UNITS[m[2]];
    },

    /**formate des secondes en texte lisible*/
    formatDuration(sec) {
        if (sec >= 31536000) return Math.round(sec / 31536000) + ' an(s)';
        if (sec >= 2592000) return Math.round(sec / 2592000) + ' mois';
        if (sec >= 86400) return Math.round(sec / 86400) + ' jour(s)';
        if (sec >= 3600) return Math.round(sec / 3600) + ' heure(s)';
        if (sec >= 60) return Math.round(sec / 60) + ' minute(s)';
        return sec + ' seconde(s)';
    },

    /**cherche un membre du serveur courant par pseudo (exact, insensible à la casse)*/
    async resolveMember(pseudo) {
        const members = await WyvernApp.api(`/api/servers/${WyvernApp.currentServerId}/members`);
        if (!Array.isArray(members)) return null;
        return members.find(m => m.pseudo.toLowerCase() === pseudo.toLowerCase()) || null;
    },

    /**cherche un utilisateur banni par pseudo (pour /unban)*/
    async resolveBanned(pseudo) {
        const bans = await WyvernApp.api(`/api/servers/${WyvernApp.currentServerId}/bans`);
        if (!Array.isArray(bans)) return null;
        return bans.find(b => b.pseudo.toLowerCase() === pseudo.toLowerCase()) || null;
    },

    /**vérifie qu'on est bien dans un serveur*/
    requireServer() {
        if (!WyvernApp.currentServerId) {
            this.feedback('Cette commande doit être utilisée dans un serveur.', 'error');
            return false;
        }
        return true;
    },

    //handlers 
    handlers: {
        async ban(args) {
            if (!this.requireServer()) return;
            if (!args.user) {
                this.feedback('Usage : /ban user:Pseudo reason:"motif" duration:7d', 'error');
                return;
            }
            const member = await this.resolveMember(args.user);
            if (!member) {
                this.feedback(`"${args.user}" n'est pas membre de ce serveur.`, 'error');
                return;
            }

            const body = { raison: args.reason || '' };
            let dureeTxt = ' définitivement';
            if (args.duration) {
                const sec = this.parseDuration(args.duration);
                if (sec === null) {
                    this.feedback(`Durée invalide : "${args.duration}". Ex : 30s, 5m, 2h, 7d, 1mo, 1y`, 'error');
                    return;
                }
                body.duree_secondes = sec;
                dureeTxt = ` pour ${this.formatDuration(sec)}`;
            }

            const res = await WyvernApp.api(
                `/api/servers/${WyvernApp.currentServerId}/ban/${member.user_id}`, 'POST', body);
            if (res.error) this.feedback(`Échec du ban : ${res.error}`, 'error');
            else this.feedback(`${member.pseudo} a été banni${dureeTxt}.`, 'success');
        },

        async unban(args) {
            if (!this.requireServer()) return;
            if (!args.user) {
                this.feedback('Usage : /unban user:Pseudo', 'error');
                return;
            }
            const banned = await this.resolveBanned(args.user);
            if (!banned) {
                this.feedback(`"${args.user}" n'est pas banni de ce serveur.`, 'error');
                return;
            }
            const res = await WyvernApp.api(
                `/api/servers/${WyvernApp.currentServerId}/unban/${banned.user_id}`, 'DELETE');
            if (res.error) this.feedback(`Échec : ${res.error}`, 'error');
            else this.feedback(`${banned.pseudo} a été débanni.`, 'success');
        },

        async kick(args) {
            if (!this.requireServer()) return;
            if (!args.user) {
                this.feedback('Usage : /kick user:Pseudo', 'error');
                return;
            }
            const member = await this.resolveMember(args.user);
            if (!member) {
                this.feedback(`"${args.user}" n'est pas membre de ce serveur.`, 'error');
                return;
            }
            const res = await WyvernApp.api(
                `/api/servers/${WyvernApp.currentServerId}/members/${member.user_id}`, 'DELETE');
            if (res.error) this.feedback(`Échec : ${res.error}`, 'error');
            else this.feedback(`${member.pseudo} a été expulsé.`, 'success');
        },

        async promote(args) {
            if (!this.requireServer()) return;
            if (!args.user) {
                this.feedback('Usage : /promote user:Pseudo', 'error');
                return;
            }
            const member = await this.resolveMember(args.user);
            if (!member) {
                this.feedback(`"${args.user}" n'est pas membre de ce serveur.`, 'error');
                return;
            }
            const res = await WyvernApp.api(
                `/api/servers/${WyvernApp.currentServerId}/members/${member.user_id}/promote`, 'POST');
            if (res.error) this.feedback(`Échec : ${res.error}`, 'error');
            else this.feedback(`${member.pseudo} est maintenant admin.`, 'success');
        },

        async demote(args) {
            if (!this.requireServer()) return;
            if (!args.user) {
                this.feedback('Usage : /demote user:Pseudo', 'error');
                return;
            }
            const member = await this.resolveMember(args.user);
            if (!member) {
                this.feedback(`"${args.user}" n'est pas membre de ce serveur.`, 'error');
                return;
            }
            const res = await WyvernApp.api(
                `/api/servers/${WyvernApp.currentServerId}/members/${member.user_id}/demote`, 'POST');
            if (res.error) this.feedback(`Échec : ${res.error}`, 'error');
            else this.feedback(`${member.pseudo} n'est plus admin.`, 'success');
        },

        async help() {
            const lines = [
                'Commandes disponibles :',
                '/ban user:Pseudo reason:"motif" duration:7d — bannir (durée optionnelle)',
                '/unban user:Pseudo — révoquer un bannissement',
                '/kick user:Pseudo — expulser sans bannir',
                '/promote user:Pseudo — promouvoir en admin (admin requis)',
                '/demote user:Pseudo — retirer les droits admin (propriétaire requis)',
                '/help — afficher cette aide',
                'Unités de durée : s, m, h, d, mo, y (ou sec, min, hrs, days, mths, yrs)'
            ];
            this.feedback(lines.join('\n'), 'info');
        }
    },

    /**affiche un message système local (visible uniquement par l'utilisateur)*/
    feedback(text, type) {
        const area = document.getElementById('message-area');
        if (!area) { console.log(`[CMD/${type}] ${text}`); return; }

        const welcome = area.querySelector('.welcome-screen, .empty-channel');
        if (welcome) welcome.remove();

        const colors = { success: '#a6e3a1', error: '#f38ba8', info: '#89b4fa' };
        const icons = { success: '✓', error: '✘,', info: 'ⓘ' };

        const div = document.createElement('div');
        div.className = 'system-message';
        div.style.cssText = `padding:8px 16px; margin:4px 0; border-left:3px solid ${colors[type]};
            background:rgba(0,0,0,0.2); border-radius:4px; color:${colors[type]};
            font-size:0.88rem; white-space:pre-wrap;`;
        div.textContent = `${icons[type]}  ${text}`;
        area.appendChild(div);
        area.scrollTop = area.scrollHeight;

        //les confirmations disparaissent après 10s
        if (type === 'success') {
            setTimeout(() => {
                div.style.transition = 'opacity 0.5s';
                div.style.opacity = '0';
                setTimeout(() => div.remove(), 500);
            }, 10000);
        }
    }
};
