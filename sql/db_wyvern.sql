SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `pseudo` varchar(50) NOT NULL,
  `mot_de_passe_hash` varchar(255) NOT NULL,
  `code_16_chiffres` varchar(16) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `photo_profil` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `pseudo` (`pseudo`),
  UNIQUE KEY `code_16_chiffres` (`code_16_chiffres`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `servers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nom` varchar(100) NOT NULL,
  `code_invitation` varchar(10) NOT NULL,
  `proprietaire_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code_invitation` (`code_invitation`),
  KEY `proprietaire_id` (`proprietaire_id`),
  CONSTRAINT `servers_ibfk_1` FOREIGN KEY (`proprietaire_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `channels` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nom` varchar(70) NOT NULL,
  `serveur_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `serveur_id` (`serveur_id`),
  CONSTRAINT `channels_ibfk_1` FOREIGN KEY (`serveur_id`) REFERENCES `servers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `contenu_chiffre` text NOT NULL,
  `auteur_id` int NOT NULL,
  `salon_id` int DEFAULT NULL,
  `destinataire_id` int DEFAULT NULL,
  `horodatage` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `est_epingle` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `auteur_id` (`auteur_id`),
  KEY `salon_id` (`salon_id`),
  KEY `destinataire_id` (`destinataire_id`),
  CONSTRAINT `messages_ibfk_1` FOREIGN KEY (`auteur_id`) REFERENCES `users` (`id`),
  CONSTRAINT `messages_ibfk_2` FOREIGN KEY (`salon_id`) REFERENCES `channels` (`id`) ON DELETE CASCADE,
  CONSTRAINT `messages_ibfk_3` FOREIGN KEY (`destinataire_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `permissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `utilisateur_id` int NOT NULL,
  `serveur_id` int NOT NULL,
  `role` enum('admin','normal') NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `utilisateur_id` (`utilisateur_id`,`serveur_id`),
  KEY `serveur_id` (`serveur_id`),
  CONSTRAINT `permissions_ibfk_1` FOREIGN KEY (`utilisateur_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `permissions_ibfk_2` FOREIGN KEY (`serveur_id`) REFERENCES `servers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `polls` (
  `id` int NOT NULL AUTO_INCREMENT,
  `message_id` int NOT NULL,
  `question_chiffree` text NOT NULL,
  `date_fin` timestamp NULL,
  PRIMARY KEY (`id`),
  KEY `message_id` (`message_id`),
  CONSTRAINT `polls_ibfk_1` FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `server_bans` (
  `id` int NOT NULL AUTO_INCREMENT,
  `serveur_id` int NOT NULL,
  `utilisateur_id` int NOT NULL,
  `raison_chiffree` text,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `serveur_id` (`serveur_id`),
  KEY `utilisateur_id` (`utilisateur_id`),
  CONSTRAINT `bans_ibfk_1` FOREIGN KEY (`serveur_id`) REFERENCES `servers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `bans_ibfk_2` FOREIGN KEY (`utilisateur_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

COMMIT;