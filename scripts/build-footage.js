// Construit data/footage.json : plans Pixabay choisis par secteur et par mot-clé (HD, pertinents, variés).
// Usage : node --env-file=.env scripts/build-footage.js   (relancer pour rafraîchir la bibliothèque)
const fs = require('fs');
const path = require('path');
const { pixabay, judge, words, fold, banned } = require('../api/videos.js').internals;

// secteur -> requêtes filmables (anglais, 2 à 3 mots : sujet, lieu ou geste)
const SECTORS = {
  saas: ['team meeting office', 'woman laptop desk', 'man typing laptop', 'developer coding screen', 'business handshake', 'startup team brainstorming', 'video call laptop', 'office coworking space', 'woman phone coffee', 'whiteboard planning team', 'celebrating team office', 'tablet business'],
  marketing: ['social media phone', 'content creator camera', 'marketing team meeting', 'photographer studio', 'video editing computer', 'woman laptop cafe', 'influencer filming phone', 'presentation screen team', 'analytics chart laptop', 'designer desk computer'],
  ecommerce: ['online shopping laptop', 'woman shopping bags', 'package delivery door', 'packing parcel warehouse', 'credit card payment', 'unboxing box', 'fashion store clothes', 'courier delivery bike', 'smartphone shopping woman', 'gift box ribbon'],
  restaurant: ['chef kitchen cooking', 'waiter serving table', 'restaurant dining people', 'coffee shop barista', 'pizza oven', 'wine glasses dinner', 'bar cocktail bartender', 'food preparation chef', 'restaurant owner tablet', 'cafe terrace friends'],
  health: ['doctor patient consultation', 'nurse hospital hallway', 'medical team surgery', 'pharmacy medicine', 'doctor tablet clinic', 'dentist patient', 'physiotherapy exercise', 'woman doctor phone', 'hospital reception', 'laboratory scientist microscope'],
  finance: ['accountant calculator desk', 'money counting cash', 'bank card payment', 'financial charts screen', 'businessman signing contract', 'stock market screen', 'invoice paperwork office', 'woman calculator laptop', 'coins savings piggy', 'tax documents desk'],
  realestate: ['house keys handover', 'modern house exterior', 'apartment interior living room', 'real estate agent couple', 'architect blueprint plans', 'construction site crane', 'new home family', 'kitchen modern interior', 'city buildings aerial', 'moving boxes home'],
  education: ['student studying laptop', 'classroom teacher students', 'online learning woman', 'university campus students', 'library books reading', 'children school learning', 'teacher whiteboard', 'graduation students', 'kid tablet learning', 'student notebook writing'],
  fitness: ['gym workout man', 'woman yoga mat', 'running city morning', 'personal trainer client', 'cycling road', 'weights dumbbell gym', 'stretching woman exercise', 'swimming pool athlete', 'healthy food meal prep', 'smartwatch running'],
  travel: ['airplane window sky', 'hotel room luxury', 'tourist beach vacation', 'city street travel', 'airport terminal travelers', 'mountain hiking backpack', 'road trip car', 'hotel reception guest', 'sunset beach couple', 'suitcase travel woman'],
  beauty: ['woman makeup mirror', 'hair salon stylist', 'skincare cream face', 'spa massage relax', 'nail salon manicure', 'perfume bottle', 'woman skin care', 'barber shop haircut', 'cosmetics brush', 'bathroom skincare routine'],
  automotive: ['car driving road', 'mechanic garage repair', 'car dealership showroom', 'electric car charging', 'car wash cleaning', 'driver steering wheel', 'tire change garage', 'car interior dashboard', 'parking lot cars', 'motorcycle rider'],
  logistics: ['warehouse worker boxes', 'cargo truck highway', 'container port ship', 'forklift warehouse', 'delivery van city', 'courier package', 'shipping containers cranes', 'barcode scanner warehouse', 'airplane cargo loading', 'package conveyor belt'],
  hr: ['job interview handshake', 'recruiter candidate office', 'team meeting people', 'employees working together', 'resume paper desk', 'onboarding new employee', 'woman manager laptop', 'office colleagues talking', 'video interview laptop', 'business team applause'],
  legal: ['lawyer office desk', 'judge gavel court', 'signing contract pen', 'law books library', 'lawyer client meeting', 'justice scales statue', 'businesswoman contract', 'notary documents stamp', 'legal documents folder', 'handshake agreement'],
  it: ['server room data center', 'programmer night coding', 'cybersecurity laptop hacker', 'network cables server', 'developer team office', 'laptop code screen', 'technician computer repair', 'typing keyboard hands', 'mobile app phone developer', 'robot arm technology'],
  creative: ['graphic designer tablet', 'photographer camera studio', 'video production camera', 'artist painting canvas', 'music studio microphone', 'designer sketch desk', 'film crew shooting', 'woman drawing tablet', 'podcast microphone recording', 'color palette design'],
  retail: ['store shelves customers', 'cashier checkout supermarket', 'shopping mall people', 'boutique clothes rack', 'supermarket fruit vegetables', 'store owner opening shop', 'barcode scanning cashier', 'bakery fresh bread', 'flower shop florist', 'market stall vegetables'],
  events: ['wedding couple ceremony', 'concert crowd lights', 'conference speaker audience', 'party friends celebration', 'event planner tablet', 'confetti celebration', 'business conference networking', 'festival crowd', 'catering buffet', 'champagne toast'],
  energy: ['solar panels roof', 'wind turbines field', 'electric car charging station', 'engineer power plant', 'light bulb energy', 'electrician wiring', 'smart home thermostat', 'factory industrial machines', 'engineer hard hat tablet', 'battery energy storage'],
  agriculture: ['farmer field tractor', 'greenhouse plants', 'harvest vegetables farm', 'drone farm field', 'vineyard grapes', 'cows farm milk', 'farmer tablet crops', 'organic vegetables market', 'irrigation field water', 'olive harvest'],
  pets: ['dog owner walking', 'veterinarian dog', 'cat playing home', 'puppy training', 'pet shop animals', 'dog park running', 'woman cat sofa', 'dog grooming'],
  kids: ['children playing toys', 'baby smiling mother', 'family dinner kitchen', 'kids drawing school', 'father son playground', 'toddler playing blocks', 'parents baby sleeping', 'birthday party children'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lib = new Map();

async function main() {
  let n = 0;
  for (const [sector, queries] of Object.entries(SECTORS)) {
    for (const q of queries) {
      n++;
      let hits;
      for (let t = 0; t < 3 && !hits; t++) { try { hits = await pixabay('videos/', { q, video_type: 'film', per_page: '100' }); } catch (e) { await sleep(8000); } }
      await sleep(700);
      if (!hits) { console.log('échec', q); continue; }
      const qw = words(q), authors = new Map(), picked = [];
      const scored = hits.map((h) => {
        const f = h.videos || {}, std = [f.small, f.medium, f.tiny].find((x) => x?.url);
        if (!std || h.duration < 6 || h.duration > 45) return null;
        const t = new Set(words(h.tags)), raw = fold(h.tags);
        const x = { raw, t };
        if (banned(x)) return null;
        const rel = judge(qw, t);
        if (rel < 3 && !(rel === 2)) return null;
        const hd = f.medium?.url && f.medium.height >= 1080;
        const portrait = std.height > std.width;
        const score = rel * 100 + (hd ? 25 : 0) + Math.log10((h.downloads || 0) + 1) * 12 + Math.log10((h.likes || 0) + 1) * 6 + (portrait ? 3 : 0);
        return { h, f, std, hd, score };
      }).filter(Boolean).sort((a, b) => b.score - a.score);
      for (const s of scored) {
        const g = s.h.user_id;
        if ((authors.get(g) || 0) >= 2) continue;
        authors.set(g, (authors.get(g) || 0) + 1);
        picked.push(s);
        if (picked.length >= 6) break;
      }
      for (const { h, f, std, hd } of picked) {
        const old = lib.get(h.id);
        if (old) { old.s = [...new Set([...old.s, sector])]; old.k = [...new Set([...old.k, q])]; continue; }
        lib.set(h.id, { id: h.id, g: h.user_id, s: [sector], k: [q], u: std.url, w: std.width, h: std.height, f: hd ? f.medium.url : '', fw: hd ? f.medium.width : 0, fh: hd ? f.medium.height : 0, l: f.tiny?.url || std.url, th: std.thumbnail || f.tiny?.thumbnail || '', d: h.duration, t: h.tags });
      }
      process.stdout.write(`\r${n} requêtes · ${lib.size} plans   `);
    }
  }
  const out = [...lib.values()];
  fs.writeFileSync(path.join(__dirname, '../data/footage.json'), JSON.stringify(out));
  console.log(`\n${out.length} plans écrits (${(JSON.stringify(out).length / 1024).toFixed(0)} Ko)`);
}
main();
