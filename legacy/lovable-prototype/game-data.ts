export type Choice = { text: string; correct: boolean; feedback: string };
export type Step = { prompt: string; choices: Choice[] };
export type Mission = {
  id: string;
  title: string;
  icon: string;
  country: string;
  tier: number;
  story: string;
  steps: Step[];
};

export const TIERS = [
  { name: "Village Clinic", need: 0, icon: "🛖" },
  { name: "Community Hospital", need: 150, icon: "🏥" },
  { name: "Regional Medical Center", need: 400, icon: "🏛️" },
  { name: "National Health System", need: 800, icon: "🌍" },
];

export const COUNTRIES = [
  { id: "ng", name: "Nigeria", flag: "🇳🇬", need: 0, focus: "Malaria, sickle cell, road trauma" },
  { id: "gh", name: "Ghana", flag: "🇬🇭", need: 100, focus: "Hypertension, childbirth care" },
  { id: "ke", name: "Kenya", flag: "🇰🇪", need: 250, focus: "Cholera, childhood infections" },
  { id: "za", name: "South Africa", flag: "🇿🇦", need: 450, focus: "Diabetes, trauma systems" },
  { id: "et", name: "Ethiopia", flag: "🇪🇹", need: 650, focus: "Seizures, medicine supply chains" },
];

export const MISSIONS: Mission[] = [
  {
    id: "malaria", title: "Fever in the Rainy Season", icon: "🦟", country: "ng", tier: 0,
    story: "Mama Ngozi carries her 4-year-old son Chidi into your clinic in Enugu. He has had high fever for two days and is now very sleepy.",
    steps: [
      { prompt: "What is your first step?", choices: [
        { text: "Do a malaria rapid diagnostic test and check danger signs", correct: true, feedback: "Right — test before treating, and look for severe signs." },
        { text: "Give paracetamol and send home", correct: false, feedback: "A drowsy child with fever may have severe malaria. Never send home untested." },
        { text: "Start antibiotics immediately", correct: false, feedback: "Fever in an endemic area needs malaria testing first." },
      ]},
      { prompt: "RDT is positive and Chidi is hard to wake. Treatment?", choices: [
        { text: "Oral artemether-lumefantrine", correct: false, feedback: "Oral drugs are for uncomplicated malaria only." },
        { text: "IV/IM artesunate and refer urgently", correct: true, feedback: "Excellent. Artesunate is first-line for severe malaria." },
        { text: "Herbal remedy and observe", correct: false, feedback: "Severe malaria can kill within hours." },
      ]},
    ],
  },
  {
    id: "sickle", title: "The Painful Crisis", icon: "🩸", country: "ng", tier: 0,
    story: "Tunde, 14, with known sickle cell disease, arrives crying with severe leg and back pain after playing football in the heat.",
    steps: [
      { prompt: "What does Tunde need first?", choices: [
        { text: "Strong pain relief, fluids and warmth", correct: true, feedback: "Yes — fast analgesia and hydration are key in a vaso-occlusive crisis." },
        { text: "Tell him to rest at home", correct: false, feedback: "Pain crises are emergencies needing prompt analgesia." },
        { text: "Ice packs on the legs", correct: false, feedback: "Cold can worsen sickling. Use warmth instead." },
      ]},
      { prompt: "He now has chest pain, fever and fast breathing. You suspect:", choices: [
        { text: "Acute chest syndrome — oxygen, antibiotics, refer", correct: true, feedback: "Correct. Acute chest syndrome is a leading cause of death in SCD." },
        { text: "Just anxiety", correct: false, feedback: "Never dismiss chest symptoms in sickle cell disease." },
      ]},
    ],
  },
  {
    id: "birth", title: "Midnight Delivery", icon: "🤱", country: "gh", tier: 0,
    story: "In Tamale, Akosua has just delivered her baby. Minutes later she is bleeding heavily.",
    steps: [
      { prompt: "Your immediate action?", choices: [
        { text: "Uterine massage and give oxytocin", correct: true, feedback: "Right — most postpartum haemorrhage is from uterine atony." },
        { text: "Wait to see if it stops", correct: false, feedback: "PPH can be fatal in under 2 hours." },
        { text: "Give her water and let her sleep", correct: false, feedback: "She needs active management now." },
      ]},
      { prompt: "Bleeding continues. Next?", choices: [
        { text: "IV fluids, tranexamic acid, call for transfer", correct: true, feedback: "Excellent teamwork — TXA within 3 hours saves lives." },
        { text: "Discharge in the morning", correct: false, feedback: "She is unstable and needs escalation." },
      ]},
    ],
  },
  {
    id: "bp", title: "The Silent Killer", icon: "❤️", country: "gh", tier: 1,
    story: "Uncle Kwame, 58, a trader in Kumasi, comes for a headache. His blood pressure reads 178/108.",
    steps: [
      { prompt: "Best approach?", choices: [
        { text: "Repeat reading, check for organ damage, start treatment and lifestyle advice", correct: true, feedback: "Good — confirm, assess, treat and counsel on salt intake." },
        { text: "Ignore — he feels fine", correct: false, feedback: "Hypertension is often silent until a stroke." },
      ]},
      { prompt: "How do you keep him on treatment?", choices: [
        { text: "Explain risks, simple daily regimen, schedule follow-up", correct: true, feedback: "Adherence is everything in chronic disease." },
        { text: "Give one month of pills and never follow up", correct: false, feedback: "Without follow-up most patients stop treatment." },
      ]},
    ],
  },
  {
    id: "cholera", title: "Water of the Lake", icon: "💧", country: "ke", tier: 1,
    story: "In Kisumu, ten villagers arrive with profuse watery diarrhoea in one morning. A cholera outbreak is starting.",
    steps: [
      { prompt: "Mainstay of treatment?", choices: [
        { text: "Rapid rehydration — ORS or IV Ringer's lactate", correct: true, feedback: "Yes — rehydration alone saves most cholera patients." },
        { text: "Anti-diarrhoeal tablets only", correct: false, feedback: "These do not treat dehydration." },
      ]},
      { prompt: "To stop the outbreak you should:", choices: [
        { text: "Notify health authorities, chlorinate water, community education", correct: true, feedback: "Public health response is as vital as treatment." },
        { text: "Close the clinic", correct: false, feedback: "The community needs you more than ever." },
      ]},
    ],
  },
  {
    id: "child", title: "Fast Breathing Baby", icon: "👶", country: "ke", tier: 1,
    story: "A mother in Nairobi brings 8-month-old Amani with cough and fever. You count 58 breaths per minute.",
    steps: [
      { prompt: "This suggests:", choices: [
        { text: "Pneumonia — give amoxicillin and check for danger signs", correct: true, feedback: "Correct per IMCI: fast breathing means pneumonia." },
        { text: "A simple cold", correct: false, feedback: "Over 50/min at this age is fast breathing." },
      ]},
    ],
  },
  {
    id: "trauma", title: "Highway Collision", icon: "🚑", country: "za", tier: 2,
    story: "A minibus taxi has crashed on the N2. Your team receives three patients at once.",
    steps: [
      { prompt: "Who do you treat first?", choices: [
        { text: "The quiet patient with noisy, blocked breathing", correct: true, feedback: "Airway first. The quiet patient is often the sickest." },
        { text: "The screaming patient with a broken arm", correct: false, feedback: "Screaming means a clear airway. Triage by ABCDE." },
      ]},
      { prompt: "A patient is bleeding heavily from the thigh:", choices: [
        { text: "Direct pressure / tourniquet, then IV access", correct: true, feedback: "Stop the bleeding — circulation saves lives." },
        { text: "X-ray first", correct: false, feedback: "Control haemorrhage before imaging." },
      ]},
    ],
  },
  {
    id: "diabetes", title: "Sugar Storm", icon: "🍬", country: "za", tier: 2,
    story: "Thandi, 19, is drowsy with deep rapid breathing and a fruity breath smell. Glucose is very high.",
    steps: [
      { prompt: "Most likely diagnosis and treatment?", choices: [
        { text: "DKA — IV fluids, insulin, monitor potassium", correct: true, feedback: "Spot on. Fluids first, then insulin with potassium watch." },
        { text: "Give her a sugary drink", correct: false, feedback: "That's for hypoglycaemia — dangerous here." },
      ]},
    ],
  },
  {
    id: "seizure", title: "Shaking in the Market", icon: "⚡", country: "et", tier: 2,
    story: "In Addis Ababa, a young man collapses and has been seizing for over 5 minutes.",
    steps: [
      { prompt: "What do you do?", choices: [
        { text: "Protect airway, give benzodiazepine (e.g. diazepam), check glucose", correct: true, feedback: "Correct — status epilepticus needs fast benzodiazepines." },
        { text: "Put something in his mouth", correct: false, feedback: "Never — it can cause injury and choking." },
      ]},
      { prompt: "Long term, you should also address:", choices: [
        { text: "Epilepsy stigma and reliable medicine supply", correct: true, feedback: "Community education transforms epilepsy care." },
        { text: "Nothing more", correct: false, feedback: "Continuity of care prevents future seizures." },
      ]},
    ],
  },
  {
    id: "supply", title: "The Empty Shelf", icon: "📦", country: "et", tier: 3,
    story: "Your national warehouse reports antimalarials will run out in 3 weeks across five regions.",
    steps: [
      { prompt: "Best national response?", choices: [
        { text: "Redistribute stock by need, emergency procurement, track consumption data", correct: true, feedback: "Data-driven supply chains save lives at scale." },
        { text: "Let each clinic fend for itself", correct: false, feedback: "Fragmented response deepens shortages." },
      ]},
    ],
  },
];
