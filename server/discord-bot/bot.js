'use strict';
// DevGitBrowser community bot. No message-content monitoring and no public tokens.
const {
  Client, GatewayIntentBits, Events, PermissionFlagsBits, PermissionsBitField,
  ChannelType, MessageFlags, SlashCommandBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const {
  SUPPORT_TYPES, STAFF_ROLE, ALERT_ROLE, SUPPORT_CATEGORY, ARCHIVE_CATEGORY,
  safeText, ticketTopic, parseTicket
} = require('./utils');

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const welcomeEnabled = process.env.ENABLE_WELCOME === 'true';
if (!token || !/^\d{15,22}$/.test(guildId || '')) {
  console.error('Configurer DISCORD_BOT_TOKEN et DISCORD_GUILD_ID dans .env (sur le VPS uniquement).');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, ...(welcomeEnabled ? [GatewayIntentBits.GuildMembers] : [])]
});
const noMentions = {parse: []};

const commands = [
  new SlashCommandBuilder()
    .setName('ticket').setDescription('Ouvrir un ticket privé pour DevGitBrowser')
    .addStringOption(o => o.setName('type').setDescription('Nature de la demande').setRequired(true)
      .addChoices(
        {name:'Installation / mise à jour',value:'installation'},
        {name:'Signaler un bug',value:'bug'},
        {name:'VPN / confidentialité',value:'confidentialite'},
        {name:'Candidature bêta-testeur',value:'beta'},
        {name:'Autre question',value:'autre'}
      )),
  new SlashCommandBuilder().setName('suggestion').setDescription('Proposer une amélioration de DevGitBrowser')
    .addStringOption(o => o.setName('idee').setDescription('Décris ton idée (max. 900 caractères)')
      .setRequired(true).setMaxLength(900)),
  new SlashCommandBuilder().setName('mes-roles').setDescription('Activer ou retirer les alertes de versions'),
  new SlashCommandBuilder().setName('installer-panneaux')
    .setDescription('Installer les panneaux de support, idées et alertes (équipe)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(x => x.toJSON());

const supportButtons = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('ticket:installation').setLabel('Installation').setEmoji('💻').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId('ticket:bug').setLabel('Bug').setEmoji('🐞').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('ticket:confidentialite').setLabel('Confidentialité').setEmoji('🔐').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId('ticket:beta').setLabel('Bêta-testeur').setEmoji('🧪').setStyle(ButtonStyle.Secondary)
);
const closeButton = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('ticket:close').setLabel('Archiver le ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
);
const suggestionButton = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('suggest:open').setLabel('Proposer une idée').setEmoji('💡').setStyle(ButtonStyle.Primary)
);
const alertButton = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('role:alertes').setLabel('Activer / retirer les alertes').setEmoji('🔔').setStyle(ButtonStyle.Secondary)
);

function roleByName(guild, name) {
  return guild.roles.cache.find(role => role.name === name) || null;
}
async function getCategory(guild, name, archive = false) {
  const channels = await guild.channels.fetch();
  const found = channels.find(ch => ch && ch.type === ChannelType.GuildCategory && ch.name === name);
  if (found) return found; // Ne jamais changer les permissions d'une catégorie existante.
  const staff = roleByName(guild, STAFF_ROLE);
  const overwrites = [
    {id:guild.roles.everyone.id, deny:[PermissionFlagsBits.ViewChannel]},
    {id:client.user.id, allow:[PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory]}
  ];
  if (staff) overwrites.push({
    id:staff.id, allow:[PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
  });
  const category = await guild.channels.create({
    name, type:ChannelType.GuildCategory, permissionOverwrites:overwrites,
    reason: archive ? 'Archivage privé des tickets DevGitBrowser' : 'Assistance privée DevGitBrowser'
  });
  return category;
}

async function logAction(guild, text) {
  try {
    const channel = guild.channels.cache.find(ch => ch && ch.name === 'journal-automations' && ch.type === ChannelType.GuildText);
    if (channel) await channel.send({content:safeText(text, 1500), allowedMentions:noMentions});
  } catch (err) {
    console.warn('Journal Discord indisponible :', err.message);
  }
}
function isStaff(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    interaction.member?.roles?.cache?.some(role => role.name === STAFF_ROLE);
}
async function makeTicket(interaction, type) {
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  if (!SUPPORT_TYPES.has(type)) return interaction.editReply('Type de ticket inconnu.');
  const guild = interaction.guild;
  const channels = await guild.channels.fetch();
  const existing = channels.find(ch => ch && ch.type === ChannelType.GuildText &&
    parseTicket(ch.topic)?.ownerId === interaction.user.id && !parseTicket(ch.topic).closed);
  if (existing) return interaction.editReply('Tu as déjà un ticket ouvert : ' + existing.toString());
  const category = await getCategory(guild, SUPPORT_CATEGORY);
  const staff = roleByName(guild, STAFF_ROLE);
  const overwrites = [
    {id:guild.roles.everyone.id, deny:[PermissionFlagsBits.ViewChannel]},
    {id:interaction.user.id, allow:[PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles]},
    {id:client.user.id, allow:[PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels]}
  ];
  if (staff) overwrites.push({
    id:staff.id, allow:[PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
  });
  const channel = await guild.channels.create({
    name:'ticket-' + type + '-' + interaction.user.id.slice(-6), type:ChannelType.GuildText,
    parent:category.id, topic:ticketTopic(interaction.user.id,type),
    permissionOverwrites:overwrites, reason:'Ticket privé DevGitBrowser'
  });
  await channel.send({
    content:'Bienvenue <@' + interaction.user.id + '> ! Explique ton problème et indique ta version de DevGitBrowser. ' +
      'Ne partage jamais de mot de passe, token, clé API ou information privée.',
    components:[closeButton], allowedMentions:{parse:[], users:[interaction.user.id]}
  });
  await logAction(guild, '🎫 Nouveau ticket #' + channel.name + ' (' + type + ')');
  await interaction.editReply('Ton ticket privé est prêt : ' + channel.toString());
}
async function closeTicket(interaction) {
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const channel = interaction.channel;
  const meta = parseTicket(channel?.topic);
  if (!meta || meta.closed) return interaction.editReply('Ce salon n’est pas un ticket ouvert.');
  if (meta.ownerId !== interaction.user.id && !isStaff(interaction)) {
    return interaction.editReply('Tu ne peux archiver que ton propre ticket.');
  }
  await channel.permissionOverwrites.edit(meta.ownerId, {
    ViewChannel:false, SendMessages:false, ReadMessageHistory:false
  }, {reason:'Ticket archivé'});
  const archive = await getCategory(interaction.guild, ARCHIVE_CATEGORY, true);
  await channel.setParent(archive.id, {lockPermissions:false});
  await channel.setTopic(ticketTopic(meta.ownerId,meta.type,true));
  await channel.setName(('clos-' + channel.name).slice(0,95));
  await channel.send({content:'🔒 Ticket archivé. Le support peut consulter cet historique.',allowedMentions:noMentions});
  await logAction(interaction.guild, '🔒 Ticket archivé : #' + channel.name);
  await interaction.editReply('Ticket archivé et retiré de la vue de son auteur.');
}
async function postSuggestion(interaction, suggestion) {
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const channel = (await interaction.guild.channels.fetch()).find(ch =>
    ch && ch.type === ChannelType.GuildText && ch.name === 'idees-et-suggestions');
  if (!channel) return interaction.editReply('Le salon #idees-et-suggestions est introuvable.');
  const embed = new EmbedBuilder().setColor(0x7a5cff).setTitle('💡 Proposition communautaire')
    .setDescription(safeText(suggestion, 900))
    .addFields({name:'Proposé par',value:safeText(interaction.user.username, 60),inline:true})
    .setFooter({text:'Votez avec 👍 ou 👎. Aucun lien ni identifiant sensible.'});
  const message = await channel.send({embeds:[embed], allowedMentions:noMentions});
  try {await message.react('👍'); await message.react('👎');}
  catch {console.warn('Vérifier la permission Ajouter des réactions dans #idees-et-suggestions.');}
  await interaction.editReply('Suggestion publiée : ' + message.url);
}
async function toggleAlerts(interaction) {
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const guild = interaction.guild;
  let role = roleByName(guild, ALERT_ROLE);
  if (!role) role = await guild.roles.create({
    name:ALERT_ROLE,permissions:[],mentionable:false,reason:'Opt-in alertes de versions DevGitBrowser'
  });
  const member = await guild.members.fetch(interaction.user.id);
  if (member.roles.cache.has(role.id)) {
    await member.roles.remove(role,'Désinscription volontaire aux alertes DevGitBrowser');
    return interaction.editReply('Tu ne recevras plus le rôle **' + ALERT_ROLE + '**.');
  }
  await member.roles.add(role,'Inscription volontaire aux alertes DevGitBrowser');
  return interaction.editReply('Tu as maintenant le rôle **' + ALERT_ROLE + '**.');
}
async function postOnce(channel, title, description, components) {
  const messages = await channel.messages.fetch({limit:50});
  const already = messages.find(m => m.author.id === client.user.id &&
    m.embeds?.some(e => e.title === title));
  if (already) return false;
  await channel.send({
    embeds:[new EmbedBuilder().setColor(0x7a5cff).setTitle(title).setDescription(description)],
    components:[components],allowedMentions:noMentions
  });
  return true;
}
async function installPanels(interaction) {
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.editReply('Réservé à l’administration.');
  }
  const channels = await interaction.guild.channels.fetch();
  const targets = [
    ['entraide','🛠️ DevGitBrowser • Assistance',
      'Un souci d’installation, de VPN, de sécurité ou une candidature bêta ? Ouvre un ticket privé ci-dessous.',supportButtons],
    ['idees-et-suggestions','💡 DevGitBrowser • Suggestions',
      'Propose tes idées. Les membres peuvent voter avec les réactions 👍 et 👎.',suggestionButton],
    ['general','🔔 DevGitBrowser • Alertes versions',
      'Choisis de recevoir ou non le rôle d’alerte de versions. Les annonces sont publiées dans #mises-a-jour.',alertButton]
  ];
  const results=[];
  for(const [name,title,description,components] of targets){
    const channel = channels.find(ch => ch && ch.name === name && ch.type === ChannelType.GuildText);
    if (!channel) {results.push(name + ' introuvable');continue;}
    const created = await postOnce(channel,title,description,components);
    results.push('#' + name + ' : ' + (created ? 'panneau créé' : 'déjà présent'));
  }
  await interaction.editReply(results.join('\n'));
}
async function processInteraction(interaction) {
  if (!interaction.inGuild() || interaction.guildId !== guildId) return;
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'ticket')
      return makeTicket(interaction,interaction.options.getString('type',true));
    if (interaction.commandName === 'suggestion')
      return postSuggestion(interaction,interaction.options.getString('idee',true));
    if (interaction.commandName === 'mes-roles') return toggleAlerts(interaction);
    if (interaction.commandName === 'installer-panneaux') return installPanels(interaction);
  }
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('ticket:')) {
      const type = interaction.customId.slice(7);
      return type === 'close' ? closeTicket(interaction) : makeTicket(interaction,type);
    }
    if (interaction.customId === 'role:alertes') return toggleAlerts(interaction);
    if (interaction.customId === 'suggest:open') {
      const modal = new ModalBuilder().setCustomId('suggest:submit').setTitle('Une idée pour DevGitBrowser');
      const input = new TextInputBuilder().setCustomId('idee')
        .setLabel('Décris ton amélioration').setStyle(TextInputStyle.Paragraph)
        .setMinLength(10).setMaxLength(900).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }
  }
  if (interaction.isModalSubmit() && interaction.customId === 'suggest:submit')
    return postSuggestion(interaction,interaction.fields.getTextInputValue('idee'));
}

client.on(Events.InteractionCreate, async interaction => {
  try {await processInteraction(interaction);}
  catch (error) {
    console.error('Interaction échouée :', error.message);
    const content='Action impossible. Vérifie les permissions du bot ou contacte l’équipe DevGitBrowser.';
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp({content,flags:MessageFlags.Ephemeral});
      else await interaction.reply({content,flags:MessageFlags.Ephemeral});
    } catch {console.error('Impossible de répondre à une interaction expirée.');}
  }
});
client.once(Events.ClientReady, async readyClient => {
  try {
    const guild = await readyClient.guilds.fetch(guildId);
    await guild.commands.set(commands);
    console.log('DevGitBrowser Bot connecté à '+ guild.name +' ('+guild.id+'). Commandes synchronisées.');
  } catch (error) {
    console.error('Impossible de synchroniser les commandes :',error.message);
    process.exitCode=1;
    readyClient.destroy();
  }
});
if(welcomeEnabled){
  client.on(Events.GuildMemberAdd, async member => {
    if(member.guild.id !== guildId || member.pending) return;
    try {
      const channel = (await member.guild.channels.fetch()).find(ch =>
        ch && ch.name === 'bienvenue' && ch.type === ChannelType.GuildText);
      if(channel) await channel.send({
        content:'👋 Bienvenue sur **DevGitBrowser** ! Consulte #reglement, #telechargement et #entraide. ' +
          'Site officiel : https://hempreur.github.io/DevGitBrowser/',
        allowedMentions:noMentions
      });
    } catch (err) {console.warn('Bienvenue non envoyée :',err.message);}
  });
}
client.login(token).catch(error => {console.error('Connexion Discord impossible :',error.message);process.exitCode=1;});
