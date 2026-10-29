"use client";
import "./premium.css";
import "./famous.css";
import StoryLibrary from "./StoryLibrary";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight,
  Clock3, Compass, Heart, MapPin, Menu, Mountain, Play, Plus,
  Quote, Route, Search, ShieldCheck, Sparkles, SunMedium, TentTree, Trees, Utensils, Volume2, VolumeX, X
} from "lucide-react";

const images = {
  hero: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Dhauladhar%20Mountains%2C%20Dharamsala%2C%20Himachal%20Pradesh.jpg?width=2400",
  dharamshala: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Tea%20Gardens%20Dharamshala.jpg?width=1800",
  mcleod: "https://hillpost.in/wp-content/uploads/2020/04/McLeodGanj_Tsuglagkhang_Temple-1.jpg",
  kangra: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Kangra%20Fort%20Entrance.JPG?width=1800",
  bir: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Best%20paragliding%20activity%20in%20Bir.jpg?width=1800",
  culture: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Tea%20Gardens%20Dharamshala.jpg?width=1800",
  trek: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Triund%2C%20Himachal%20Pradesh.jpg?width=1800",
  food: "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1200&q=85",
  monastery: "https://images.unsplash.com/photo-1514222134-b57cbb8ce073?auto=format&fit=crop&w=1200&q=85",
};

const destinations = [
  { name: "Palampur Tea Gardens", tag: "Kangra Valley", images: [images.dharamshala, images.dharamshala], copy: "Tea gardens beneath the snow-clad Dhauladhar range.", meta: "32.11° N", credit: "Wikimedia Commons contributors" },
  { name: "Tsuglagkhang, McLeod Ganj", tag: "Tibetan heart", images: [images.mcleod, images.mcleod], copy: "The temple complex and spiritual centre of McLeod Ganj.", meta: "32.24° N", credit: "Hill Post · Wikimedia Commons" },
  { name: "Bhagsu Waterfall", tag: "Waterfall trail", images: ["https://commons.wikimedia.org/wiki/Special:Redirect/file/Bhagsu%20falls%20%2C%20Dharmashala.jpg?width=1800", "https://commons.wikimedia.org/wiki/Special:Redirect/file/Bhagsu%20waterfalls.jpg?width=1800"], copy: "A mountain waterfall reached from Bhagsunag near McLeod Ganj.", meta: "32.25° N", credit: "Vaibhavraj241 · Nishat.ch100 · CC BY-SA" },
  { name: "Kareri Lake", tag: "Alpine lake", images: ["https://commons.wikimedia.org/wiki/Special:Redirect/file/Kareri%20Lake%201.jpg?width=1800", "https://commons.wikimedia.org/wiki/Special:Redirect/file/Shiva%20Temple%20at%20Kareri%20Lake.jpg?width=1800"], copy: "A high-altitude freshwater lake beneath the Dhauladhar ridgeline.", meta: "32.33° N", credit: "Meerah Dhiman · Wikimedia Commons" },
  { name: "Himani Chamunda", tag: "Sacred heights", images: ["https://commons.wikimedia.org/wiki/Special:Redirect/file/Aadi%20Himani%20Chamunda%20Temple.jpg?width=1800", "https://commons.wikimedia.org/wiki/Special:Redirect/file/Aadi%20Himani%20Chamunda%20Temple.jpg?width=1800"], copy: "A remote hilltop shrine reached by a demanding mountain trail.", meta: "32.18° N", credit: "Wikimedia Commons contributors" },
  { name: "Triund Ridge", tag: "Dhauladhar trail", images: [images.trek, "https://commons.wikimedia.org/wiki/Special:Redirect/file/Triund%20view%20HIMachal.jpg?width=1800"], copy: "A celebrated grassy ridge looking into the Kangra Valley.", meta: "32.25° N", credit: "Harminder Singh Saini · CC BY-SA" },
  { name: "Kangra Fort", tag: "Living heritage", images: [images.kangra, "https://commons.wikimedia.org/wiki/Special:Redirect/file/Kangra%20Fort.JPG?width=1800"], copy: "The historic stone stronghold above the rivers of Kangra Valley.", meta: "32.09° N", credit: "KartikMistry · CC BY-SA" },
  { name: "Bir–Billing", tag: "Paragliding valley", images: [images.bir, "https://commons.wikimedia.org/wiki/Special:Redirect/file/Bir%20Billing%20Paragliding.jpg?width=1800"], copy: "One of Himachal’s best-known flying landscapes.", meta: "32.06° N", credit: "Panchkaranvarun · CC BY 4.0" },
  { name: "Maa Brajeshwari Temple", tag: "Kangra Shakti Peetha", images: ["https://commons.wikimedia.org/wiki/Special:Redirect/file/Brajeshwari%20temple%20compound%20kangra%20himachal%20pradesh.jpg?width=1800", "https://commons.wikimedia.org/wiki/Special:Redirect/file/Brajeshwari%20temple%20compound%20kangra%20himachal%20pradesh.jpg?width=1800"], copy: "The historic Bajreshwari Mata shrine in the heart of Kangra town.", meta: "32.10° N", credit: "Madhrakangri · CC BY 4.0" },
  { name: "Chamunda Devi Temple", tag: "Nandikeshwar Dham", images: ["https://commons.wikimedia.org/wiki/Special:Redirect/file/Chamunda%20Devi%20Temple.jpg?width=1800", "https://commons.wikimedia.org/wiki/Special:Redirect/file/Shri%20Chamunda%20Devi%20Mandir.jpg?width=1800"], copy: "A revered riverside Devi temple between Dharamshala and Palampur.", meta: "32.15° N", credit: "Guptaele · Wikimedia Commons" },
  { name: "Jwala Ji Temple", tag: "Eternal flame", images: ["https://commons.wikimedia.org/wiki/Special:Redirect/file/Jawalamukhi%2C%20Himachal%20Pradesh.jpg?width=1800", "https://commons.wikimedia.org/wiki/Special:Redirect/file/0051223%20Jwalamukhi%20temple%2C%20Jvala%20ji%20Himachal%20Pradesh%20210.jpg?width=1800"], copy: "The ancient Shakti shrine known for its naturally burning sacred flame.", meta: "31.87° N", credit: "Wikimedia Commons · CC BY-SA / CC0" },
  { name: "Chintpurni Mata", tag: "Shakti pilgrimage", images: ["https://commons.wikimedia.org/wiki/Special:Redirect/file/Chintpurni%20Devi%20%281%29.JPG?width=1800", "https://commons.wikimedia.org/wiki/Special:Redirect/file/Chintpurni.jpg?width=1800"], copy: "A major hill shrine dedicated to Maa Chhinnamastika in Una district.", meta: "31.81° N", credit: "Wikimedia Commons contributors" },
  { name: "Maa Naina Devi", tag: "Hilltop sanctuary", images: ["https://commons.wikimedia.org/wiki/Special:Redirect/file/Mandir%20Maa%20Naina%20Devi.jpg?width=1800", "https://commons.wikimedia.org/wiki/Special:Redirect/file/Naina%20devi%20Himachal%20Pradesh.jpg?width=1800"], copy: "A celebrated hilltop Shakti Peetha overlooking the Bilaspur landscape.", meta: "31.30° N", credit: "Wikimedia Commons contributors" },
  { name: "Hidimba Devi Temple", tag: "Cedar forest shrine", images: ["https://commons.wikimedia.org/wiki/Special:Redirect/file/Devi%20Hidimba%20Temple%20Manali.jpg?width=1800", "https://commons.wikimedia.org/wiki/Special:Redirect/file/Hadimba%20Devi%20Temple%20Manali.jpg?width=1800"], copy: "A sixteenth-century wooden temple set within Manali’s cedar forest.", meta: "32.25° N", credit: "Wikimedia Commons contributors" },
];

const month = new Date().getMonth() + 1;
const climate = month >= 10 || month <= 3 ? "winter" : month >= 7 && month <= 9 ? "monsoon" : "summer";
const climateLabel = climate === "winter" ? "Dhauladhar snow season" : climate === "monsoon" ? "Himalayan monsoon" : "Mountain summer";

const seasons = {
  Spring: { note: "Fresh green foothills · Clear snow peaks", temp: "8–22°C", wash: "#93b68b", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Dhauladhar%20range%20from%20Palampur.jpg?width=2200" },
  Summer: { note: "Pine-framed ridges · Long clear days", temp: "18–30°C", wash: "#d6a85f", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Dhauladhars.jpg?width=2200" },
  Monsoon: { note: "Cloud-wrapped peaks · Deep green valleys", temp: "18–26°C", wash: "#567e78", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Cloudy%20Triund%2C%20above%20Mcleod%20Ganj%2C%20Himachal%20Pradesh.jpg?width=2200" },
  Autumn: { note: "Golden forest · Crisp mountain light", temp: "10–24°C", wash: "#a96f45", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Autumn%20trees%20in%20dhauladhar%20mountain%20range.jpg?width=2200" },
  Winter: { note: "Snow-clad Dhauladhar · Quiet villages", temp: "0–15°C", wash: "#9eb4c0", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/After%20the%20overnight%20snowfall%20%2822356836830%29.jpg?width=2200" },
};

const districts = [
  { name: "Bilaspur", place: "Gobind Sagar · Naina Devi", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Mandir%20Maa%20Naina%20Devi.jpg?width=2000", copy: "Hilltop pilgrimage routes and wide views across the Gobind Sagar landscape." },
  { name: "Chamba", place: "Chamba town · Bharmour", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/0051723%20Chamunda%20Devi%20temple%2C%20Chamba%2C%20Himachal%20Pradesh%20199.jpg?width=2000", copy: "Ancient temples, carved wood, mountain villages, and the high Ravi valley." },
  { name: "Hamirpur", place: "Sujanpur Tira · Nadaun", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Sujanpur%20Tira%20Fort.jpg?width=2000", copy: "Low Himalayan hills, historic Sujanpur, and quiet settlements beside the Beas." },
  { name: "Kangra", place: "Dharamshala · Palampur", image: images.dharamshala, copy: "Dhauladhar peaks, tea country, Tibetan heritage, forts, lakes, and sacred temples." },
  { name: "Kinnaur", place: "Kalpa · Sangla · Chitkul", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Kinnaur%20Kailash%20from%20Kalpa.jpg?width=2000", copy: "Dramatic rock faces, apple country, wooden villages, and the upper Sutlej." },
  { name: "Kullu", place: "Manali · Tirthan · Naggar", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Kullu%20Valley.jpg?width=2000", copy: "River valleys, cedar forests, traditional villages, and high mountain passes." },
  { name: "Lahaul & Spiti", place: "Key · Kaza · Chandratal", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Key%20Monastery.jpg?width=2000", copy: "A high-altitude cold desert of monasteries, fossil valleys, and luminous skies." },
  { name: "Mandi", place: "Prashar · Rewalsar", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Prashar%20Lake.jpg?width=2000", copy: "Temple architecture, forest lakes, river confluences, and old hill-town lanes." },
  { name: "Shimla", place: "Shimla · Mashobra · Narkanda", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Shimla%20city.jpg?width=2000", copy: "Heritage streets, cedar ridges, orchards, and broad Himalayan viewpoints." },
  { name: "Sirmaur", place: "Renuka · Nahan · Churdhar", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Renuka%20Lake.jpg?width=2000", copy: "A gentler southern Himalaya of sacred lakes, forests, and the Churdhar summit." },
  { name: "Solan", place: "Kasauli · Chail · Solan", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Kasauli%20Himachal%20Pradesh.jpg?width=2000", copy: "Pine-clad cantonment towns, mountain rail heritage, gardens, and quiet trails." },
  { name: "Una", place: "Chintpurni · Dera Baba Barbhag Singh", image: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Chintpurni%20Devi%20%281%29.JPG?width=2000", copy: "Shakti pilgrimage, warm foothill landscapes, and gateways into the Kangra hills." },
];

const mapPoints = [[43,79],[35,28],[52,68],[48,50],[65,18],[58,40],[77,24],[54,58],[70,48],[39,72],[50,76],[57,82]];
const districtAtlasMeta = [
  ["673 m","Oct–Mar","Gobind Sagar","Naina Devi"],["996 m","Mar–Jun","Khajjiar","Bharmour"],["790 m","Oct–Mar","Sujanpur","Nadaun"],["1,457 m","Mar–Jun","Dharamshala","Palampur"],
  ["2,960 m","Apr–Oct","Kalpa","Chitkul"],["1,279 m","Mar–Jun","Manali","Tirthan"],["3,800 m","Jun–Oct","Key Monastery","Chandratal"],["760 m","Mar–Jun","Prashar","Rewalsar"],
  ["2,276 m","Mar–Jun","Shimla","Narkanda"],["932 m","Oct–Apr","Renuka","Churdhar"],["1,550 m","Mar–Jun","Kasauli","Chail"],["369 m","Oct–Mar","Chintpurni","Pong wetlands"],
];

const districtStories = [
  { hindi:"बिलासपुर", mood:"Lake country & sacred heights", season:"October–March", elevation:"673 m", food:"Patrode · Dham", highlights:["Gobind Sagar","Naina Devi","Bhakra landscape"], access:"Road connections from Chandigarh and Kiratpur; allow extra time on hill sections.", permit:"No general permit for the district; verify site-specific access." },
  { hindi:"चंबा", mood:"Temple valleys & cedar trails", season:"March–June", elevation:"996 m", food:"Chamba madra · Chha gosht", highlights:["Chamba town","Bharmour","Khajjiar"], access:"Mountain roads from Pathankot; remote valleys need additional planning.", permit:"Check local requirements before Pangi or borderward routes." },
  { hindi:"हमीरपुर", mood:"Warm foothills & old forts", season:"October–March", elevation:"790 m", food:"Sepu badi · Dham", highlights:["Sujanpur Tira","Nadaun","Deotsidh"], access:"Well connected by road from Una, Kangra and Bilaspur.", permit:"No general tourism permit; confirm monument hours locally." },
  { hindi:"कांगड़ा", mood:"Dhauladhar, tea & living faith", season:"March–June", elevation:"1,457 m", food:"Kangri dham · Madra", highlights:["Dharamshala","Palampur","Bir Billing"], access:"Kangra airport, Pathankot railhead and regional buses serve the valley.", permit:"Trekking and flying activities may require registered operators." },
  { hindi:"किन्नौर", mood:"Apple valleys & sacred peaks", season:"April–October", elevation:"2,960 m", food:"Chilta · Thukpa", highlights:["Kalpa","Sangla","Chitkul"], access:"Long mountain approach via the Hindustan–Tibet Road; landslides can delay travel.", permit:"Some border areas require permits; verify current rules." },
  { hindi:"कुल्लू", mood:"River valleys & cedar villages", season:"March–June", elevation:"1,279 m", food:"Siddu · Trout", highlights:["Manali","Naggar","Tirthan Valley"], access:"Road and air links via Bhuntar; high passes close seasonally.", permit:"Protected areas and some treks can require registration or guides." },
  { hindi:"लाहौल और स्पीति", mood:"Cold desert & monastery sky", season:"June–October", elevation:"3,800 m", food:"Thukpa · Aktori", highlights:["Key Monastery","Kaza","Chandratal"], access:"High-altitude roads are seasonal; fuel, cash and medical access are limited.", permit:"Foreign visitors may need inner-line permits for specified routes." },
  { hindi:"मंडी", mood:"Temple town & forest lakes", season:"March–June", elevation:"760 m", food:"Mandi dham · Bhey", highlights:["Prashar Lake","Rewalsar","Barot"], access:"Central road hub linking Shimla, Kullu, Kangra and Bilaspur.", permit:"Check forest and trekking access before remote routes." },
  { hindi:"शिमला", mood:"Heritage ridges & orchard light", season:"March–June", elevation:"2,276 m", food:"Babru · Siddu", highlights:["Shimla","Narkanda","Mashobra"], access:"Connected by road, air and the Kalka–Shimla heritage railway.", permit:"Vehicle and parking restrictions apply in central Shimla." },
  { hindi:"सिरमौर", mood:"Sacred lakes & southern forests", season:"October–April", elevation:"932 m", food:"Askaloo · Patande", highlights:["Renuka Lake","Nahan","Churdhar"], access:"Road approaches from Chandigarh, Solan and Dehradun.", permit:"Check sanctuary, forest and Churdhar trail guidance locally." },
  { hindi:"सोलन", mood:"Pine towns & mountain rail", season:"March–June", elevation:"1,550 m", food:"Siddu · Seasonal pickles", highlights:["Kasauli","Chail","Solan"], access:"Frequent road and heritage-rail access from the Chandigarh region.", permit:"Some cantonment areas restrict photography and vehicle entry." },
  { hindi:"ऊना", mood:"Pilgrimage gateways & wetlands", season:"October–March", elevation:"369 m", food:"Dham · Mittha", highlights:["Chintpurni","Pong wetlands","Dera Baba Barbhag Singh"], access:"Rail and road gateway from Punjab into lower Himachal.", permit:"No general permit; check festival traffic and temple arrangements." },
];

const districtFamous = [
  { sacred:["Shri Naina Devi Ji","Markandeya Temple","Vyas Cave"], nature:["Gobind Sagar Lake","Koldam reservoir","Bahadurpur hills"], heritage:["Bhakra Dam viewpoints","Bahadurpur Fort remains","Old Bilaspur memories"], experiences:["Lake boating","Hilltop pilgrimage","Nalwari fair"], culture:["Bilaspuri dham","Patrode","Nalwari cattle-fair tradition"] },
  { sacred:["Lakshmi Narayan Temple","Chamunda Devi Temple","Manimahesh pilgrimage"], nature:["Khajjiar","Kalatop sanctuary","Chamera Lake","Pangi Valley"], heritage:["Chamba town","Bhuri Singh Museum","Rang Mahal","Bharmour temples"], experiences:["Dalhousie walks","Manimahesh trek","Village and valley journeys"], culture:["Chamba rumal","Chamba chappal","Minjar Fair","Chamba madra"] },
  { sacred:["Baba Balak Nath, Deotsidh","Awah Devi","Tauni Devi","Gasota Mahadev"], nature:["Beas riverside at Nadaun","Sujanpur hills","Lower Himalayan forests"], heritage:["Sujanpur Tira Fort","Narbadeshwar Temple murals","Nadaun old town"], experiences:["Fort and temple circuit","Riverside walks","Village fairs"], culture:["Hamirpuri dham","Sepu badi","Hamir Utsav","Local folk traditions"] },
  { sacred:["Maa Brajeshwari","Jwala Ji","Chamunda Devi","Baijnath Temple","Tsuglagkhang"], nature:["Dhauladhar Range","Kareri Lake","Triund","Pong Dam wetlands","Bhagsu waterfall"], heritage:["Kangra Fort","Masroor rock-cut temples","Norbulingka Institute","Andretta artists’ village"], experiences:["Bir Billing paragliding","Palampur tea gardens","Dharamshala walks","Trekking"], culture:["Kangra painting","Kangri dham","Gaddi heritage","Kangra tea"] },
  { sacred:["Kinnaur Kailash","Chandika Temple, Kothi","Mathi Temple, Chitkul"], nature:["Sangla Valley","Baspa River","Nako Lake","Chitkul","Kalpa viewpoints"], heritage:["Kamru Fort","Traditional Kath-Kuni villages","Reckong Peo","Moorang Fort"], experiences:["Orchard stays","High-valley road journey","Village walks","Stargazing"], culture:["Kinnauri shawls","Kinnauri cap","Apple and chilgoza","Phulaich festival"] },
  { sacred:["Hidimba Devi","Manikaran Sahib","Bijli Mahadev","Raghunath Temple"], nature:["Great Himalayan National Park","Tirthan Valley","Solang Valley","Rohtang landscape","Parvati Valley"], heritage:["Naggar Castle","Manali old village","Nicholas Roerich estate"], experiences:["Trekking","Rafting","Skiing and snow activities","Kasol and village trails"], culture:["Kullu shawls","Kullu Dussehra","Siddu","Valley deity traditions"] },
  { sacred:["Key Monastery","Tabo Monastery","Dhankar Monastery","Trilokinath Temple"], nature:["Chandratal","Pin Valley","Kunzum Pass","Sissu waterfall","Suraj Tal"], heritage:["Kaza","Kibber","Hikkim","Langza","Gue mummy"], experiences:["High-altitude road journeys","Fossil village walks","Stargazing","Monastery circuit"], culture:["Spitian thangka traditions","Thukpa and tsampa","Losar","Mud-house architecture"] },
  { sacred:["Bhootnath Temple","Triloknath Temple, Mandi","Shikari Devi","Kamrunag Temple"], nature:["Prashar Lake","Rewalsar Lake","Barot Valley","Janjehli","Pandoh Lake"], heritage:["Mandi old town","Temple ghats","Sundernagar"], experiences:["Lake and temple circuit","Barot trout country","Forest hikes","Seraj valley journeys"], culture:["Mandi Shivratri","Mandyali dham","Metal and wood traditions","Seraj folk culture"] },
  { sacred:["Jakhu Temple","Tara Devi","Hatu Temple","Bhimakali Temple, Sarahan"], nature:["Mashobra","Narkanda","Chanshal Pass","Chail forests","Tani Jubbar Lake"], heritage:["The Ridge and Mall Road","Viceregal Lodge","Kalka–Shimla railway","Gaiety Theatre","Rampur"], experiences:["Heritage walks","Toy-train journey","Apple-country stays","Winter skating"], culture:["Himachali caps","Apple cuisine","Lavi Fair","Shimla theatre heritage"] },
  { sacred:["Renuka Ji temples","Trilokpur Bala Sundari","Jagannath Temple, Nahan","Shirgul Temple, Churdhar"], nature:["Renuka Lake","Churdhar Peak","Simbalbara National Park","Habban Valley"], heritage:["Nahan old town","Jaitak Fort","Paonta Sahib heritage"], experiences:["Churdhar trek","Wildlife walks","Lake circuit","Quiet hill-town stays"], culture:["Sirmauri nati","Patande","Renuka Fair","Local wool and bamboo craft"] },
  { sacred:["Jatoli Shiv Temple","Mohan Shakti Heritage Park","Shoolini Temple","Kali Tibba, Chail"], nature:["Kasauli hills","Chail forests","Karol Tibba","Barog"], heritage:["Kasauli cantonment","Dagshai","Barog railway station","Solan old bazaar"], experiences:["Heritage railway stops","Forest walks","Garden and brewery history","Weekend hill stays"], culture:["Shoolini Fair","Mushroom and tomato produce","Pickles and preserves","Baghat traditions"] },
  { sacred:["Maa Chintpurni","Dera Baba Barbhag Singh","Shiv Bari Temple","Dhyunsar Mahadev"], nature:["Pong wetland approaches","Swan River landscape","Dharamshala Mahanta forests"], heritage:["Kutlehar forts and palaces","Una old settlements","Amb and Haroli region"], experiences:["Shakti pilgrimage circuit","Wetland birding","Foothill village journeys"], culture:["Dham and mittha","Hola Mohalla traditions","Chintpurni fairs","Lower-hill folk culture"] },
];

const guideItems = [
  { name:"Maa Brajeshwari", type:"Sacred", district:"Kangra", detail:"Historic Shakti Peetha in Kangra town", icon:"ॐ" },
  { name:"Jwala Ji", type:"Sacred", district:"Kangra", detail:"Ancient shrine of the eternal natural flame", icon:"✦" },
  { name:"Chintpurni Mata", type:"Sacred", district:"Una", detail:"Major hill shrine of Maa Chhinnamastika", icon:"ॐ" },
  { name:"Kareri Lake", type:"Nature", district:"Kangra", detail:"Alpine freshwater lake and trekking route", icon:"≈" },
  { name:"Triund Ridge", type:"Trek", district:"Kangra", detail:"Popular ridge walk above McLeod Ganj", icon:"△" },
  { name:"Pin Parvati Pass", type:"Trek", district:"Kullu", detail:"Serious high-altitude expedition route", icon:"△" },
  { name:"Key Monastery", type:"Culture", district:"Lahaul & Spiti", detail:"Tibetan Buddhist monastery above the Spiti valley", icon:"✦" },
  { name:"Kangra Painting", type:"Culture", district:"Kangra", detail:"Delicate Pahari miniature-painting tradition", icon:"✎" },
  { name:"Kangri Dham", type:"Food", district:"Kangra", detail:"Ceremonial feast served in traditional courses", icon:"◉" },
  { name:"Siddu", type:"Food", district:"Shimla & Kullu", detail:"Steamed wheat bread with savoury fillings", icon:"◉" },
  { name:"Hidimba Devi", type:"Sacred", district:"Kullu", detail:"Wooden temple within Manali's cedar forest", icon:"ॐ" },
  { name:"Chandratal", type:"Nature", district:"Lahaul & Spiti", detail:"High-altitude crescent lake in the cold desert", icon:"≈" },
];

const cultureStories = [
  ["Kangra miniature painting","Fine-line Pahari art shaped by poetry, devotion, and the Kangra courts."],
  ["Kullu weaving","Handwoven shawls and geometric borders carrying valley-specific traditions."],
  ["Gaddi pastoral life","Seasonal movement, wool craft, and enduring knowledge of the Dhauladhars."],
  ["Tibetan heritage","Monasteries, medicine, food, language, and contemporary life around Dharamshala."],
];

const foods = [
  ["Kangri Dham","Kangra","A festive multi-course meal traditionally cooked by botis."],
  ["Siddu","Shimla · Kullu","Steamed wheat bread served warm with ghee or dal."],
  ["Madra","Chamba · Kangra","Yogurt-based chickpea curry scented with warm spices."],
  ["Babru","Shimla","Crisp black-gram-filled bread, often paired with tamarind chutney."],
  ["Chha Gosht","Chamba","Mutton cooked in a tangy yogurt and gram-flour gravy."],
  ["Aktori","Lahaul & Spiti","A traditional buckwheat preparation from the high valleys."],
];

const hiddenHimachal = [
  ["Pangi Valley","Chamba","A remote Chenab valley of old trails, high passes and village hospitality.","Best approached with local guidance"],
  ["Jibhi & Shoja","Kullu","Forest hamlets, wooden homes and gentle walks below Jalori Pass.","Travel outside holiday rushes"],
  ["Rakchham","Kinnaur","A quiet Baspa Valley village between Sangla and Chitkul.","Respect orchard and village paths"],
  ["Barot Valley","Mandi","Trout streams, cedar slopes and the historic haulage railway story.","Carry waste back"],
  ["Churah Valley","Chamba","Deep-cut valleys, temple villages and routes toward the Pir Panjal.","Check road conditions locally"],
  ["Daranghati","Shimla","A forest sanctuary landscape beyond Rampur and Sarahan.","Use a registered local guide"],
];

const festivals = [
  ["JAN–FEB","Losar","Lahaul & Spiti","Tibetan New Year traditions across the high valleys."],
  ["FEB–MAR","Mandi Shivratri","Mandi","A gathering of hill deities and one of the state’s defining fairs."],
  ["APR","Minjar preparations","Chamba","Craft, music and community traditions lead toward the summer fair."],
  ["JUL–AUG","Minjar Fair","Chamba","A historic week of processions, performance and Ravi Valley culture."],
  ["SEP–OCT","Kullu Dussehra","Kullu","Valley deities assemble in Dhalpur after Dussehra begins elsewhere."],
  ["NOV–DEC","Lavi Fair","Shimla","The old Rampur trade fair connects the Sutlej valleys and highlands."],
];

const heritage = [
  ["8th–12th c.","Temple landscapes","Early stone and timber traditions take form across Chamba, Kangra and the Sutlej valleys."],
  ["17th–19th c.","Pahari kingdoms & painting","Hill courts support distinctive schools of miniature painting, architecture and poetry."],
  ["1850s onward","Hill stations & railways","Shimla, Kasauli and mountain transport reshape movement through the lower Himalayas."],
  ["1905","Kangra earthquake","A devastating earthquake transforms towns, monuments and community memory."],
  ["1959 onward","Tibetan life in exile","Dharamshala becomes an important centre of Tibetan religion, culture and contemporary life."],
  ["1971","Himachal statehood","The modern state is formed while its many regional identities remain distinct."],
];

const treks = [
  ["Triund","Easy–Moderate","2,850 m","1–2 days","Mar–Jun · Sep–Nov"],
  ["Kareri Lake","Moderate","2,950 m","2–3 days","Apr–Jun · Sep–Nov"],
  ["Hampta Pass","Moderate","4,270 m","4–5 days","Jun–Sep"],
  ["Pin Parvati","Difficult","5,319 m","9–12 days","Jul–Sep"],
];

const localMakers = [
  ["Kullu loom trail","Weaving","Kullu","Meet cooperative weavers and learn how regional motifs are made."],
  ["Kangra art studio","Painting","Kangra","See the mineral pigments and fine brushwork behind Pahari miniatures."],
  ["Palampur tea room","Farm","Kangra","Taste local tea close to the gardens where it is grown."],
  ["Spiti homestay circle","Homestays","Spiti","Village-run stays that keep more visitor spending within the valley."],
];

const almanacChapters = [
  { number:"01", title:"Identity", subtitle:"Land in the lap of snow", copy:"Himachal Pradesh lies in the Western Himalayas of northern India. Its name joins hima—snow—with achal, mountain or abode. The state is also widely called Dev Bhoomi, the Land of Gods, and Veer Bhoomi, the Land of the Brave.", facts:["Formed 15 April 1948","Statehood 25 January 1971","Capital Shimla · winter capital Dharamshala"] },
  { number:"02", title:"History", subtitle:"Kingdoms, routes and statehood", copy:"Prehistoric communities, Vedic-era republics, hill principalities and Rajput kingdoms all shaped the region. Kangra, Chamba, Mandi, Bushahr and other hill states developed distinct courts and traditions before the colonial era and the gradual formation of modern Himachal.", facts:["Masroor rock-cut temples","Kangra and Chamba hill kingdoms","Full statehood in 1971"] },
  { number:"03", title:"Geography", subtitle:"Foothills to the high Himalaya", copy:"Across a compact north–south span, subtropical Shivalik foothills rise through the Lesser Himalaya to the Greater Himalaya and cold desert. Deep valleys, high passes and sharp changes in altitude create dramatically different landscapes and climates.", facts:["Area 55,673 km²","Reo Purgyil · 6,816 m","12 mountain districts"] },
  { number:"04", title:"Rivers & climate", subtitle:"A state carved by water", copy:"The Sutlej, Beas, Ravi, Chenab and Yamuna systems drain the state. Snowmelt and monsoon rain sustain forests, farms and hydropower, while conditions vary from warm southern valleys to alpine and cold-desert climates.", facts:["Five major river systems","Monsoon generally July–September","Snow common at higher elevations in winter"] },
  { number:"05", title:"People & languages", subtitle:"Many valleys, many voices", copy:"Most residents live in rural settlements. Hindi is the official language and Sanskrit has additional official status, while a rich family of Western Pahari and local languages—including Kangri, Mandeali, Kullui, Chambyali and Kinnauri varieties—carries valley identity.", facts:["Official: Hindi","Additional official: Sanskrit","Strong village and pastoral traditions"] },
  { number:"06", title:"Culture", subtitle:"Craft practiced, not displayed", copy:"Temple architecture, Buddhist monasteries, Kangra miniature painting, Kullu weaving, Chamba rumal embroidery, silver jewellery, Himachali caps, folk music and seasonal fairs form a living cultural landscape rather than a single uniform tradition.", facts:["Kullu Dussehra","Mandi Shivratri","Minjar and Lavi fairs"] },
  { number:"07", title:"Food & farming", subtitle:"Altitude on the plate", copy:"Terraced agriculture, orchards, tea gardens and pastoral life shape the table. Dham, madra, siddu, babru, chha gosht and high-valley buckwheat dishes vary by district; apples and Kangra tea are among the state’s best-known products.", facts:["Apple and stone-fruit orchards","Kangra tea country","Dham ceremonial feast"] },
  { number:"08", title:"Economy & energy", subtitle:"Mountain livelihoods", copy:"Agriculture, horticulture, tourism, hydropower, manufacturing and services support the state. Rivers provide major renewable-energy potential, while tourism and construction must be balanced carefully with fragile slopes, forests and water systems.", facts:["Horticulture is a major livelihood","Important hydropower producer","Tourism spans pilgrimage, nature and adventure"] },
  { number:"09", title:"Travel & transport", subtitle:"Roads across changing terrain", copy:"Roads are the principal way through the hills, supplemented by narrow-gauge heritage railways and airports serving Shimla, Kangra and Kullu. Mountain travel times can change rapidly with weather, landslides, snow and seasonal closures.", facts:["Kalka–Shimla heritage railway","Kangra Valley narrow-gauge railway","Verify roads and permits locally"] },
  { number:"10", title:"Nature & learning", subtitle:"Forests, wildlife and knowledge", copy:"Deodar, pine, oak and alpine habitats support snow leopard, western tragopan, Himalayan black bear and many other species. Protected landscapes and institutions across the state connect conservation, mountain research, medicine, agriculture and education.", facts:["State tree · Deodar cedar","State bird · Western tragopan","State animal · Snow leopard"] },
];

const plans: Record<string, { title: string; place: string; detail: string }[]> = {
  "2": [
    { title: "Arrive gently", place: "Dharamshala · Naddi", detail: "Tea garden stroll, local lunch, and sunset toward the Dhauladhars." },
    { title: "Walk the Tibetan quarter", place: "McLeod Ganj", detail: "Tsuglagkhang, quiet lanes, Bhagsu, and an evening café." },
  ],
  "3": [
    { title: "Valley beginnings", place: "Kangra · Dharamshala", detail: "Kangra Fort, tea gardens, and a slow mountain sunset." },
    { title: "A living heritage", place: "McLeod Ganj", detail: "Tsuglagkhang, Tibetan Museum, local food, and forest paths." },
    { title: "Into the pines", place: "Dharamkot · Naddi", detail: "A gentle trail, mountain café, and an unhurried final evening." },
  ],
  "5": [
    { title: "Land in the valley", place: "Kangra", detail: "Fort walls, temple town, and the valley’s older stories." },
    { title: "Meet Dharamshala", place: "Dharamshala", detail: "Tea gardens, War Memorial, stadium views, and local markets." },
    { title: "Tibetan heart", place: "McLeod Ganj", detail: "Monastic life, art, food, and contemplative spaces." },
    { title: "Climb higher", place: "Dharamkot · Triund", detail: "A guided day hike chosen for conditions and your experience." },
    { title: "A softer goodbye", place: "Palampur", detail: "Tea country, village craft, and a long lunch before departure." },
  ]
};

export default function Home() {
  const [menu, setMenu] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [season, setSeason] = useState<keyof typeof seasons>("Autumn");
  const [days, setDays] = useState("3");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [destinationIndex, setDestinationIndex] = useState(0);
  const [placeFrame, setPlaceFrame] = useState(0);
  const [treeSnowBurst, setTreeSnowBurst] = useState(0);
  const [districtIndex, setDistrictIndex] = useState(0);
  const [districtStory, setDistrictStory] = useState<number | null>(null);
  const [storyImage, setStoryImage] = useState(0);
  const [routeFrom, setRouteFrom] = useState(0);
  const [guideQuery, setGuideQuery] = useState("");
  const [guideType, setGuideType] = useState("All");
  const [atlasSeason, setAtlasSeason] = useState("Any season");
  const [atlasDifficulty, setAtlasDifficulty] = useState("Any level");
  const [atlasDuration, setAtlasDuration] = useState("Any duration");
  const [hoveredDistrict, setHoveredDistrict] = useState<number | null>(null);
  const [zoomDistrict, setZoomDistrict] = useState<number | null>(null);
  const [nearStatus, setNearStatus] = useState("Explore near me");
  const [selectedGuide, setSelectedGuide] = useState<typeof guideItems[number] | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [comparePosition, setComparePosition] = useState(52);
  const [passport, setPassport] = useState<string[]>([]);
  const [tripMood, setTripMood] = useState("Nature");
  const [tripBudget, setTripBudget] = useState("Comfort");
  const [tripStart, setTripStart] = useState("Delhi");
  const [sessionClock, setSessionClock] = useState("--:--");
  const [dayPart, setDayPart] = useState("day");
  const soundRef = useRef<{ctx:AudioContext,source:AudioBufferSourceNode}|null>(null);
  const itinerary = useMemo(() => plans[days] ?? plans["3"], [days]);
  const guideResults = useMemo(() => guideItems.filter(item => (guideType==="All"||item.type===guideType) && `${item.name} ${item.type} ${item.district} ${item.detail}`.toLowerCase().includes(guideQuery.toLowerCase()) && (atlasDifficulty==="Any level" || (atlasDifficulty==="Gentle" ? item.type!=="Trek" : item.type==="Trek")) && (atlasDuration==="Any duration" || (atlasDuration==="Half day" ? !["Pin Parvati Pass","Chandratal"].includes(item.name) : true)) && (atlasSeason==="Any season" || atlasSeason!=="Monsoon" || item.type!=="Trek") && (atlasSeason!=="Winter" || ["Sacred","Culture","Food"].includes(item.type))), [guideQuery,guideType,atlasDifficulty,atlasDuration,atlasSeason]);
  const atlasHeading = guideType==="Sacred"?["Find your","sacred path."]:guideType==="Nature"?["Follow the","alpine lakes."]:guideType==="Trek"?["Climb toward","the ridgelines."]:guideType==="Culture"?["Meet the","living heritage."]:guideType==="Food"?["Taste the","mountain table."]:["Find your own","way through."];
  const todayFestival = festivals[[0,0,1,2,2,3,3,3,4,4,5,5][new Date().getMonth()]];

  useEffect(() => {
    const savedPlans = localStorage.getItem("himalaya-saved");
    if (savedPlans) {
      window.setTimeout(() => {
        try {
          const parsed = JSON.parse(savedPlans);
          if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
            setSaved(parsed);
          }
        } catch {
          localStorage.removeItem("himalaya-saved");
        }
      }, 0);
    }
    const stamps = localStorage.getItem("himalaya-passport");
    if (stamps) {
      window.setTimeout(() => {
        try {
          const parsed = JSON.parse(stamps);
          if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
            setPassport(parsed);
          }
        } catch {
          localStorage.removeItem("himalaya-passport");
        }
      }, 0);
    }
    const updateClock = () => { const now=new Date(); const hour=now.getHours(); setSessionClock(now.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})); setDayPart(hour<6?"night":hour<11?"dawn":hour<17?"day":hour<20?"evening":"night"); };
    updateClock(); const clock=window.setInterval(updateClock,60000); return ()=>window.clearInterval(clock);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setPlaceFrame((frame) => (frame + 1) % destinations[destinationIndex].images.length), 2600);
    return () => window.clearInterval(timer);
  }, [destinationIndex]);

  const toggleSave = (name: string) => {
    const next = saved.includes(name) ? saved.filter((x) => x !== name) : [...saved, name];
    setSaved(next); localStorage.setItem("himalaya-saved", JSON.stringify(next));
  };

  const stampPassport = (name:string) => {
    const next = passport.includes(name) ? passport.filter(x=>x!==name) : [...passport,name];
    setPassport(next); localStorage.setItem("himalaya-passport",JSON.stringify(next));
  };

  const exploreNearMe = () => {
    if(!navigator.geolocation){setNearStatus("Location unavailable");return;}
    setNearStatus("Finding your nearest valley…");
    navigator.geolocation.getCurrentPosition(({coords})=>{
      const anchors=[[31.34,76.75],[32.55,76.13],[31.68,76.52],[32.10,76.27],[31.54,78.27],[31.96,77.11],[32.25,78.03],[31.59,76.92],[31.10,77.17],[30.56,77.30],[30.90,77.10],[31.47,76.27]];
      let nearest=0,best=Infinity; anchors.forEach(([lat,lng],i)=>{const d=(lat-coords.latitude)**2+(lng-coords.longitude)**2;if(d<best){best=d;nearest=i}});
      setDistrictIndex(nearest); setZoomDistrict(nearest); setHoveredDistrict(nearest); setNearStatus(`Nearest: ${districts[nearest].name}`);
    },()=>setNearStatus("Location not shared"),{enableHighAccuracy:false,timeout:8000});
  };

  const surpriseMe = () => {
    const hidden=[1,4,6,7,9]; const next=hidden[Math.floor(Math.random()*hidden.length)];
    setDistrictIndex(next); setZoomDistrict(next); setHoveredDistrict(next); setGuideQuery(""); setGuideType("All");
  };

  const toggleMountainSound = () => {
    if (soundRef.current) { soundRef.current.source.stop(); soundRef.current.ctx.close(); soundRef.current=null; setSoundOn(false); return; }
    const ctx = new AudioContext(); const buffer=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate); const data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*.16;
    const source=ctx.createBufferSource(); source.buffer=buffer; source.loop=true; const filter=ctx.createBiquadFilter(); filter.type="lowpass"; filter.frequency.value=520; const gain=ctx.createGain(); gain.gain.value=.12;
    source.connect(filter).connect(gain).connect(ctx.destination); source.start(); soundRef.current={ctx,source}; setSoundOn(true);
  };

  return (
    <main className={`time-${dayPart}`}>
      <div className={`weather-world ${climate}`} aria-hidden="true">
        {climate === "winter" && Array.from({length:54},(_,i)=><i className="snowflake" key={i} style={{"--x":`${(i*37)%100}vw`,"--d":`${7+(i%8)}s`,"--delay":`${-(i%13)}s`,"--size":`${3+(i%6)}px`} as React.CSSProperties}/>) }
        {climate === "monsoon" && <><div className="rain"/><div className="lightning"/></>}
        {climate === "summer" && <div className="summer-sun"/>}
      </div>
      <div className={`climate-badge ${climate}`}><span/><b>{climateLabel}</b><small>{climate === "winter" ? "Oct — Mar" : climate === "monsoon" ? "Jul — Sep" : "Apr — Jun"}</small></div>
      <button className="sound-toggle" onClick={toggleMountainSound} aria-label={soundOn?"Turn mountain ambience off":"Turn mountain ambience on"}>{soundOn?<Volume2/>:<VolumeX/>}<span>{soundOn?"Mountain sound on":"Hear the mountains"}</span></button>
      <nav className="nav">
        <a className="brand" href="#top"><span className="brand-mark"><Mountain size={18}/></span><span>HIMALAYA<small>HIMACHAL PRADESH</small></span></a>
        <div className="nav-links"><a href="#living-atlas">Journey map</a><a href="#districts">Districts</a><a href="#discover">Places</a><a href="#stories">Stories</a><a href="#planner">Plan</a></div>
        <div className="nav-actions"><button className="saved-pill"><Heart size={15}/>{saved.length || "Saved"}</button><button className="nav-cta" onClick={() => document.querySelector("#planner")?.scrollIntoView({behavior:"smooth"})}>Plan your journey <ArrowRight size={16}/></button><button className="menu" onClick={()=>setMenu(!menu)} aria-label="Toggle menu">{menu?<X/>:<Menu/>}</button></div>
      </nav>
      {menu && <div className="mobile-menu"><a href="#living-atlas" onClick={()=>setMenu(false)}>Journey map</a><a href="#districts" onClick={()=>setMenu(false)}>All districts</a><a href="#discover" onClick={()=>setMenu(false)}>Places</a><a href="#stories" onClick={()=>setMenu(false)}>Stories & festivals</a><a href="#planner" onClick={()=>setMenu(false)}>Plan a trip</a></div>}
      <div className="explore-dock" aria-label="Explore Himachal"><span><Compass/> Explore Himachal</span><a href="#districts">Districts</a><a href="#season">Seasons</a><a href="#discover">Temples</a><a href="#journey">Treks</a><a href="#living-himachal">Food</a><a href="#almanac">Almanac</a></div>

      <section className="hero" id="top" style={{backgroundImage:`url(${images.hero})`}}>
        <div className="hero-sky"/><div className="fog fog-a"/><div className="fog fog-b"/>
        <div className="hero-birds" aria-hidden="true"><img className="wings-up" src="/images/himalayan-birds-flight.png" alt=""/><img className="wings-down" src="/images/himalayan-birds-wings-down.png" alt=""/></div>
        <div className="deodar-photo" role="button" tabIndex={0} aria-label="Snow-covered Himalayan deodar cedar. Click to shake snow from its branches." onClick={()=>setTreeSnowBurst(n=>n+1)} onKeyDown={(e)=>{if(e.key==="Enter"||e.key===" ")setTreeSnowBurst(n=>n+1)}}>
          <img src="/images/deodar-winter-photoreal.png" alt="A real snow-covered Himalayan deodar cedar" />
          {treeSnowBurst>0&&<div className="tree-snow-burst" key={treeSnowBurst} aria-hidden="true">{Array.from({length:44},(_,i)=>{
            const branchPoints = [[47,18],[30,29],[66,31],[20,43],[52,44],[80,48],[14,59],[39,60],[67,64],[87,68],[27,76],[57,79]];
            const [branchX,branchY] = branchPoints[i%branchPoints.length];
            return <i key={i} style={{"--sx":`${branchX+((i*7)%9)-4}%`,"--sy":`${branchY+((i*5)%7)-3}%`,"--sdx":`${((i%7)-3)*9}px`,"--sd":`${1.35+(i%7)*.16}s`,"--ss":`${3+(i%5)*1.3}px`,"--sdelay":`${(i%11)*.028}s`} as React.CSSProperties}/>;
          })}</div>}
          <div className="deodar-photo-label"><i/><span><b>HIMALAYAN DEODAR</b><small>Winter canopy · Cedrus deodara</small></span></div>
        </div>
        <div className="hero-content"><div className="eyebrow"><span/> Dhauladhar Range, Dharamshala · 32.2190° N</div><h1>Where the<br/>mountains <em>whisper.</em></h1><p>Wander through cedar forests, ancient valleys, and the living Tibetan heart of the western Himalayas.</p><div className="hero-buttons"><a className="primary" href="#discover">Explore Himachal <ArrowRight size={18}/></a><a className="ghost" href="#journey"><Play size={16} fill="currentColor"/> Begin the journey</a></div></div>
        <div className="hero-meta"><div><small>NOW EXPLORING</small><strong>Dhauladhar Range</strong></div><div className="weather"><SunMedium/><span><b>Autumn</b><small>Best for clear views</small></span></div></div><a href="#intro" className="scroll"><span>SCROLL TO DISCOVER</span><ArrowDown size={16}/></a>
      </section>

      <section className="intro" id="intro"><div className="section-number">01 <span/></div><div className="intro-copy"><p className="kicker">A LAND ABOVE THE CLOUDS</p><h2>Not just a place.<br/>A <em>change of pace.</em></h2></div><div className="intro-aside"><p>Himachal asks you to slow down. To notice the scent of deodar after rain, butter lamps glowing at dusk, and the first snow catching dawn.</p><a href="#culture">Meet the spirit of Himachal <ArrowRight size={16}/></a></div><div className="stats"><div><strong>{destinations.length}</strong><span>places to begin</span></div><div><strong>5</strong><span>distinct seasons</span></div><div><strong>∞</strong><span>reasons to linger</span></div></div></section>

      <section className="today-himachal"><div><p className="kicker">TODAY IN HIMACHAL</p><h2>{dayPart==="dawn"?"A clear mountain morning.":dayPart==="evening"?"Golden hour in the valleys.":dayPart==="night"?"A quieter Himalayan night.":"The mountains are awake."}</h2></div><div className="today-grid"><article><SunMedium/><small>CURRENT SEASON</small><b>{climate==="winter"?"Winter snowline":climate==="monsoon"?"Monsoon green":"Mountain summer"}</b><span>{climateLabel}</span></article><article><Clock3/><small>LOCAL DAYLIGHT</small><b>{sessionClock}</b><span>Device-local time</span></article><article><CalendarDays/><small>SEASONAL STORY</small><b>{todayFestival[1]}</b><span>{todayFestival[2]} · confirm dates</span></article><article><Compass/><small>RECOMMENDED NOW</small><b>{climate==="winter"?"Kangra & Solan":climate==="monsoon"?"Palampur & Tirthan":"Spiti & Kinnaur"}</b><span>Weather and roads vary</span></article></div></section>

      <section className="districts" id="districts"><div className="districts-head"><div><p className="kicker">ALL 12 DISTRICTS</p><h2>The whole of<br/><em>Himachal Pradesh.</em></h2></div><p>Choose a district to reveal its landscape, then open its immersive bilingual story.</p></div><div className="district-explorer"><div key={districts[districtIndex].name} className="district-feature"><img src={districts[districtIndex].image} alt={`${districts[districtIndex].name} district, Himachal Pradesh`} onError={(e)=>{e.currentTarget.src=images.hero}}/><div className="district-shade"/><span className="district-number">{String(districtIndex+1).padStart(2,"0")} / 12</span><div className="district-feature-copy"><small>{districts[districtIndex].place}</small><h3><span>{districtStories[districtIndex].hindi}</span>{districts[districtIndex].name}</h3><p>{districts[districtIndex].copy}</p><button onClick={()=>{setStoryImage(0);setDistrictStory(districtIndex)}}>Enter the district story <ArrowRight/></button></div></div><div className="district-grid">{districts.map((district,i)=><button className={i===districtIndex?"active":""} onClick={()=>setDistrictIndex(i)} key={district.name}><span>{String(i+1).padStart(2,"0")}</span><b>{districtStories[i].hindi}<small>{district.name}</small></b><ArrowRight size={15}/></button>)}</div></div></section>

      <section className={`explore-map atlas-v2 ${zoomDistrict!==null?"district-zoom":""}`} id="explore-map"><div className="map-panel"><div className="topo-clouds" aria-hidden="true"/><div className="map-outline"><svg viewBox="0 0 520 500" aria-hidden="true"><defs><linearGradient id="altitude" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#315f45"/><stop offset=".52" stopColor="#486b79"/><stop offset="1" stopColor="#dce9ec"/></linearGradient><filter id="terrain"><feTurbulence baseFrequency=".018" numOctaves="3" seed="7"/><feBlend mode="soft-light" in2="SourceGraphic"/></filter></defs><path className="state-shape" d="M76 323L112 246l50-30 24-82 62-49 74 38 69-25 58 49-22 80 45 55-57 64-31 81-86-17-67 42-62-55-77-5z"/><g className="district-lines"><path d="M112 246l89 42 47-203M201 288l97 122m-50-203 179 20M201 288l-32 89m129-86 86 36M298 410l86-83M248 207l-47 81"/></g><path className="river" d="M125 175 C190 220 185 300 260 310 S370 270 425 352"/><g className="contour-rings"><ellipse cx="260" cy="260" rx="195" ry="145"/><ellipse cx="265" cy="255" rx="165" ry="118"/><ellipse cx="270" cy="245" rx="130" ry="90"/><ellipse cx="278" cy="235" rx="96" ry="62"/></g><path key={`${routeFrom}-${districtIndex}`} className="journey-route" d={`M ${mapPoints[routeFrom][0]*5.2} ${mapPoints[routeFrom][1]*5} Q 260 220 ${mapPoints[districtIndex][0]*5.2} ${mapPoints[districtIndex][1]*5}`}/></svg>{districts.map((d,i)=><button key={d.name} className={i===districtIndex?"active":""} style={{left:`${mapPoints[i][0]}%`,top:`${mapPoints[i][1]}%`}} onMouseEnter={()=>setHoveredDistrict(i)} onMouseLeave={()=>setHoveredDistrict(null)} onClick={()=>{setDistrictIndex(i);setZoomDistrict(zoomDistrict===i?null:i)}} aria-label={`Explore ${d.name}`}><i/><span>{d.name}</span></button>)}<div className="district-popover"><img src={districts[hoveredDistrict??districtIndex].image} alt={`${districts[hoveredDistrict??districtIndex].name} landscape`}/><div><small>{districtAtlasMeta[hoveredDistrict??districtIndex][0]} · {districtAtlasMeta[hoveredDistrict??districtIndex][1]}</small><h3>{districts[hoveredDistrict??districtIndex].name}</h3><p>{districtAtlasMeta[hoveredDistrict??districtIndex][2]} · {districtAtlasMeta[hoveredDistrict??districtIndex][3]}</p></div></div></div><div className="route-time"><Route/><span>BUILD A JOURNEY<div className="route-selects"><select aria-label="Route origin" value={routeFrom} onChange={e=>setRouteFrom(Number(e.target.value))}>{districts.map((d,i)=><option value={i} key={d.name}>{d.name}</option>)}</select><i>→</i><select aria-label="Route destination" value={districtIndex} onChange={e=>setDistrictIndex(Number(e.target.value))}>{districts.map((d,i)=><option value={i} key={d.name}>{d.name}</option>)}</select></div><small>{routeFrom===districtIndex?"Choose another district":`${2+Math.abs(routeFrom-districtIndex)}–${4+Math.abs(routeFrom-districtIndex)} hr illustrative drive`}</small></span></div><div className="map-caption"><Compass/><span><b>Select a district</b><small>Hover for a real photo · click to zoom and reveal its story</small></span><button onClick={()=>setDistrictStory(districtIndex)}>Open full story <ArrowRight/></button></div></div><div className="guide-search"><div className="atlas-actions"><button onClick={exploreNearMe}><MapPin/>{nearStatus}</button><button onClick={surpriseMe}><Sparkles/>Surprise me</button></div><p className="kicker">SEARCH THE STATE</p><h2 key={guideType}>{atlasHeading[0]}<br/><em>{atlasHeading[1]}</em></h2><label className="search-field"><Search/><input value={guideQuery} onChange={e=>setGuideQuery(e.target.value)} placeholder="Search temple, trek, lake, food…"/></label><div className="guide-types">{["All","Sacred","Nature","Trek","Culture","Food"].map(type=><button className={guideType===type?"active":""} onClick={()=>setGuideType(type)} key={type}>{type}</button>)}</div><div className="atlas-filters"><select aria-label="Season" value={atlasSeason} onChange={e=>setAtlasSeason(e.target.value)}><option>Any season</option><option>Spring</option><option>Summer</option><option>Monsoon</option><option>Autumn</option><option>Winter</option></select><select aria-label="Difficulty" value={atlasDifficulty} onChange={e=>setAtlasDifficulty(e.target.value)}><option>Any level</option><option>Gentle</option><option>Adventure</option></select><select aria-label="Duration" value={atlasDuration} onChange={e=>setAtlasDuration(e.target.value)}><option>Any duration</option><option>Half day</option><option>Multi-day</option></select><span>{guideResults.length} discoveries</span></div><div className="guide-results card-trail">{guideResults.map(item=><button onClick={()=>setSelectedGuide(item)} key={item.name}><img src={districts.find(d=>item.district.includes(d.name))?.image||images.hero} alt=""/><span className="result-icon">{item.icon}</span><div><small>{item.type} · {item.district}</small><b>{item.name}</b><p>{item.detail}</p></div><ArrowRight/></button>)}</div></div></section>

      <section className="living-atlas" id="living-atlas"><div className="atlas-head"><p className="kicker">REAL SATELLITE JOURNEY MAP</p><h2>Cross Himachal<br/><em>ridge by ridge.</em></h2><p>Real Google satellite geography from the Shivalik foothills to the cold-desert valleys. Select a district marker, or open a mountain region in Google Earth for full 3D terrain.</p></div><div className="route-stage real-map"><iframe title="Google satellite map of Himachal Pradesh" src="https://maps.google.com/maps?q=Himachal%20Pradesh%2C%20India&t=k&z=7&output=embed" loading="lazy" referrerPolicy="no-referrer-when-downgrade"/><div className="map-vignette" aria-hidden="true"/>{[0,3,7,5,10,8,4,6].map((d,i)=><button key={districts[d].name} style={{left:`${7+i*12.3}%`,top:`${70-(i%3)*20}%`}} onClick={()=>{setDistrictIndex(d);document.querySelector("#districts")?.scrollIntoView({behavior:"smooth"})}}><span>{i+1}</span><b>{districts[d].name}</b><small>{districts[d].place.split(" · ")[0]}</small></button>)}</div><div className="earth-links"><span>OPEN REAL MOUNTAIN TERRAIN IN 3D</span>{[["Dhauladhar","Dhauladhar Range, Himachal Pradesh"],["Kinnaur Kailash","Kinnaur Kailash, Himachal Pradesh"],["Spiti Valley","Spiti Valley, Himachal Pradesh"],["Manali & Rohtang","Rohtang Pass, Himachal Pradesh"]].map(([label,query])=><a key={label} href={`https://earth.google.com/web/search/${encodeURIComponent(query)}`} target="_blank" rel="noreferrer"><Mountain/>{label}<ArrowRight/></a>)}</div><div className="mountain-pulse"><div><span>TRAVEL PULSE · UPDATED IN YOUR SESSION</span><b>{sessionClock}</b><small>Local device time</small></div><div><span>SNOWLINE WATCH</span><b>{climate==="winter"?"Active":"Seasonal"}</b><small>Verify district advisories</small></div><div><span>DAYLIGHT MOOD</span><b>{dayPart==="dawn"?"Morning":dayPart==="day"?"Mountain day":dayPart==="evening"?"Golden hour":"Starlight"}</b><small>The homepage responds to time</small></div><div><span>ROAD & TRAIL STATUS</span><b>Check locally</b><small>Conditions change quickly</small></div></div></section>

      <section className="discover" id="discover"><div className="section-head"><div><p className="kicker">REAL PLACES · ANIMATED PHOTO STORIES</p><h2>Places with a<br/><em>sense of soul.</em></h2></div><div className="carousel-controls"><button onClick={()=>setDestinationIndex((destinationIndex+destinations.length-1)%destinations.length)}><ChevronLeft/></button><span>{String(destinationIndex+1).padStart(2,"0")} / {String(destinations.length).padStart(2,"0")}</span><button onClick={()=>setDestinationIndex((destinationIndex+1)%destinations.length)}><ChevronRight/></button></div></div><div className="destination-track" style={{transform:`translateX(calc(-${destinationIndex} * min(36vw, 420px)))`}}>{destinations.map((d,i)=><article className={`destination-card ${i===destinationIndex?"selected":""}`} key={d.name} onClick={()=>setDestinationIndex(i)}>{d.images.map((src,frame)=><img className={`place-frame ${frame===(i===destinationIndex?placeFrame:0)?"active":""}`} src={src} alt={`${d.name}, Himachal Pradesh — view ${frame+1}`} key={`${d.name}-${frame}`}/>) }<div className="place-progress">{d.images.map((_,frame)=><i className={frame===(i===destinationIndex?placeFrame:0)?"active":""} key={frame}/>)}</div><div className="card-shade"/><button className={`heart ${saved.includes(d.name)?"active":""}`} onClick={(e)=>{e.stopPropagation();toggleSave(d.name)}} aria-label={`Save ${d.name}`}><Heart size={18} fill={saved.includes(d.name)?"currentColor":"none"}/></button><div className="card-top"><span>{d.tag}</span><span>{d.meta}</span></div><div className="card-copy"><span className="index">{String(i+1).padStart(2,"0")}</span><h3>{d.name}</h3><p>{d.copy}</p><small className="photo-credit">Photo: {d.credit}</small><span className="explore-link"><MapPin size={14}/> Select to explore</span></div></article>)}</div></section>

      <section className="journey" id="journey"><div className="journey-image" style={{backgroundImage:`url(${images.trek})`}}><div className="contours"/><div className="trail"><i/><i/><i/><i/></div><div className="altitude"><Mountain/><span>TRIUND RIDGELINE · REAL LOCATION<small>Above McLeod Ganj · conditions vary</small></span></div></div><div className="journey-copy"><p className="kicker">JOURNEY INTO THE DHAULADHARS</p><h2>Leave the road.<br/><em>Find the rhythm.</em></h2><p>Walk from the cedar shade of Dharamkot toward wide ridgelines and valley views. Routes here reward preparation, patience, and local guidance.</p><div className="journey-steps"><div className="active"><span>01</span><div><b>Enter the forest</b><small>Deodar shade · stone paths</small></div></div><div><span>02</span><div><b>Rise above the valley</b><small>Changing light · open views</small></div></div><div><span>03</span><div><b>Reach the ridgeline</b><small>Weather permitting</small></div></div></div><a className="text-link" href="#planner">Explore mindful adventures <ArrowRight size={16}/></a></div></section>

      <section className="culture" id="culture"><div className="culture-image" style={{backgroundImage:`url(${images.culture})`}}><div className="culture-caption"><span>KANGRA VALLEY</span><p>Tradition lives in the details.</p></div></div><div className="culture-copy"><p className="kicker">THE HEART OF THE HIMALAYAS</p><h2>Stories carried<br/>from <em>hand to hand.</em></h2><p>From the precise brushwork of Kangra miniature painting to shared dham feasts and the prayer flags of McLeod Ganj, culture here is practiced—not displayed.</p><div className="culture-list"><a href="#gallery"><span>01</span>Kangra art & craft<ArrowRight/></a><a href="#gallery"><span>02</span>Tibetan heritage<ArrowRight/></a><a href="#gallery"><span>03</span>Food & village life<ArrowRight/></a></div></div></section>

      <section className="living-himachal" id="living-himachal"><div className="living-head"><p className="kicker">LIVING HIMACHAL</p><h2>Culture you can<br/><em>listen to, taste and learn.</em></h2><p>Explore living traditions with respect. Ask before photographing people or ceremonies, support local makers, and enter sacred spaces thoughtfully.</p></div><div className="culture-archive">{cultureStories.map(([name,copy],i)=><article key={name}><span>0{i+1}</span><h3>{name}</h3><p>{copy}</p></article>)}</div><div className="food-head"><Utensils/><div><small>DISTRICT FOOD EXPLORER</small><h3>A table shaped by altitude.</h3></div></div><div className="food-grid">{foods.map(([name,district,copy])=><article key={name}><span>{district}</span><h4>{name}</h4><p>{copy}</p></article>)}</div></section>

      <section className="story-world" id="stories"><div className="story-intro"><p className="kicker">VOICES OF THE HILLS</p><h2>Listen before<br/><em>you arrive.</em></h2><p>Short interpretive audio moments introduce the sounds, words and practices that give each valley its character.</p></div><div className="voice-cards">{[["The shepherd’s path","Gaddi pastoral knowledge","Dhauladhar foothills"],["A painter’s brush","Kangra miniature tradition","Kangra"],["The monastery bell","A morning in the Spiti valley","Spiti"],["Dham is served","The rhythm of a community feast","Kangra"]].map(([name,copy,place],i)=><button key={name} onClick={toggleMountainSound}><span className="voice-play">{soundOn?<Volume2/>:<Play/>}</span><small>0:{24+i*7} · {place}</small><h3>{name}</h3><p>{copy}</p></button>)}</div><small className="audio-note">Atmospheric interpretation, not archival field recordings. Use headphones for the full soundscape.</small>
      <div className="hidden-head"><p className="kicker">HIDDEN HIMACHAL</p><h2>Make room for<br/><em>the quieter valleys.</em></h2></div><div className="hidden-grid">{hiddenHimachal.map(([name,district,copy,note])=><article key={name}><span>{district}</span><h3>{name}</h3><p>{copy}</p><small><ShieldCheck/> {note}</small></article>)}</div></section>

      <section className="calendar-heritage"><div className="festival-panel"><p className="kicker">A YEAR IN CELEBRATION</p><h2>Festival calendar.</h2><div className="festival-list">{festivals.map(([date,name,place,copy])=><article key={name}><time>{date}</time><div><h3>{name}</h3><span>{place}</span><p>{copy}</p></div></article>)}</div><small>Festival dates follow local calendars and can change. Confirm before travelling.</small></div><div className="heritage-panel"><p className="kicker">HERITAGE TIMELINE</p><h2>Stories across centuries.</h2><div className="timeline">{heritage.map(([date,name,copy])=><article key={date}><time>{date}</time><div><h3>{name}</h3><p>{copy}</p></div></article>)}</div></div></section>

      <section className="himachal-almanac" id="almanac"><div className="almanac-intro"><div><p className="kicker">THE HIMACHAL ALMANAC</p><h2>A whole state,<br/><em>chapter by chapter.</em></h2></div><div className="almanac-lead"><p>A concise field guide to the history, land, rivers, people, culture, economy and everyday life of Himachal Pradesh—designed for exploration, not endless scrolling.</p><a href="#almanac-chapters">Open the first chapter <ArrowDown/></a></div></div><div className="almanac-profile"><div><small>STATE AT A GLANCE</small><strong>55,673</strong><span>square kilometres</span></div><div><small>THE HIGH POINT</small><strong>6,816 m</strong><span>Reo Purgyil</span></div><div><small>ADMINISTRATIVE MAP</small><strong>12</strong><span>districts</span></div><div><small>TIME & IDENTITY</small><strong>IST · IN-HP</strong><span>UTC +05:30</span></div></div><div className="almanac-chapters" id="almanac-chapters">{almanacChapters.map((chapter,i)=><details key={chapter.title} open={i===0}><summary><span>{chapter.number}</span><div><small>{chapter.subtitle}</small><h3>{chapter.title}</h3></div><Plus/></summary><div className="almanac-body"><p>{chapter.copy}</p><ul>{chapter.facts.map(fact=><li key={fact}>{fact}</li>)}</ul></div></details>)}</div><div className="almanac-note"><ShieldCheck/><p><b>Editorial note.</b> This chaptered overview is a concise interpretation of the reference supplied for the project. Population, economy, office-holders, transport access and other time-sensitive facts should be checked against current official Himachal Pradesh and Government of India sources.</p></div></section>

      <section className="trek-lab"><div className="trek-head"><p className="kicker">ADVENTURE, WITH CONTEXT</p><h2>Know the mountain<br/><em>before the climb.</em></h2></div><div className="trek-table"><div className="trek-row trek-labels"><span>Route</span><span>Difficulty</span><span>High point</span><span>Typical time</span><span>Season</span></div>{treks.map(([name,level,alt,time,best])=><div className="trek-row" key={name}><b>{name}</b><span className={`difficulty ${level.toLowerCase().replace("–","-")}`}>{level}</span><span>{alt}</span><span>{time}</span><span>{best}</span></div>)}</div><p className="trek-warning"><ShieldCheck/> Altitude, weather and route conditions vary. Use qualified guides where appropriate and never treat this overview as a substitute for local advice.</p>
      <div className="season-compare"><div className="compare-copy"><p className="kicker">BEFORE / AFTER</p><h3>One mountain.<br/>Two seasons.</h3><p>Drag the divider to compare the green monsoon Dhauladhars with their winter form.</p></div><div className="compare-frame"><img src={seasons.Monsoon.image} alt="Dhauladhar mountains during monsoon"/><div className="compare-top" style={{width:`${comparePosition}%`}}><img src={seasons.Winter.image} alt="Dhauladhar mountains during winter"/></div><input aria-label="Compare winter and monsoon mountain views" type="range" min="5" max="95" value={comparePosition} onChange={e=>setComparePosition(Number(e.target.value))}/><span style={{left:`${comparePosition}%`}}>↔</span><small className="winter-label">WINTER</small><small className="monsoon-label">MONSOON</small></div></div></section>

      <section className="passport-market"><div className="passport"><p className="kicker">YOUR HIMACHAL PASSPORT</p><h2>Collect the valleys.</h2><p>Save a digital stamp as you explore. Your collection stays in this browser.</p><div className="stamp-grid">{districts.map(d=><button className={passport.includes(d.name)?"stamped":""} onClick={()=>stampPassport(d.name)} key={d.name}><Mountain/><b>{d.name}</b><small>{passport.includes(d.name)?"STAMPED":"ADD STAMP"}</small></button>)}</div><div className="passport-progress"><span style={{width:`${passport.length/12*100}%`}}/><b>{passport.length} / 12 districts collected</b></div></div><div className="makers"><p className="kicker">LOCAL HANDS, LOCAL VALUE</p><h2>Meet the makers.</h2><p>A discovery directory for thoughtful local experiences. Contact and booking should always be verified directly.</p>{localMakers.map(([name,type,place,copy])=><article key={name}><span>{type}</span><div><h3>{name}</h3><small>{place}</small><p>{copy}</p></div><ArrowRight/></article>)}</div></section>

      <section className="season-section" id="season"><div key={season} className="season-visual season-reveal" style={{backgroundImage:`linear-gradient(180deg, transparent, ${seasons[season].wash}aa), url(${seasons[season].image})`}}><span className="season-word">{season}</span><div className="season-info"><b>{seasons[season].temp}</b><span>{seasons[season].note}</span></div></div><div className="season-copy"><p className="kicker">CHOOSE YOUR SEASON</p><h2>Every month,<br/><em>a different mountain.</em></h2><p>The valley changes its mood throughout the year. Pick a season to see the mountain landscape—and the kind of days it invites.</p><div className="season-tabs">{Object.keys(seasons).map(s=><button className={s===season?"active":""} key={s} onClick={()=>setSeason(s as keyof typeof seasons)}>{s}</button>)}</div><p className="season-note"><Sparkles size={16}/> Conditions in the Himalayas change quickly. Check local advisories before travel or trekking.</p></div></section>

      <section className="planner" id="planner"><div className="planner-head"><div><p className="kicker">SMART HIMACHAL TRIP BUILDER</p><h2>Build a few days<br/>worth <em>remembering.</em></h2></div><p>Choose your starting point, pace and budget. The planner reshapes a practical inspiration route that you can save, adapt and print.</p></div><div className="planner-shell"><div className="planner-form"><label>Starting city<select value={tripStart} onChange={e=>setTripStart(e.target.value)}><option>Delhi</option><option>Chandigarh</option><option>Amritsar</option><option>Pathankot</option></select></label><label>How long are you staying?<div className="day-picker">{["2","3","5"].map(d=><button className={days===d?"active":""} onClick={()=>setDays(d)} key={d}>{d}<small>days</small></button>)}</div></label><label>Your travel mood<div className="chips">{[["Nature",Trees],["Adventure",TentTree],["Culture",Sparkles],["Slow travel",Compass]].map(([mood,Icon])=><button className={tripMood===mood?"selected":""} onClick={()=>setTripMood(String(mood))} key={String(mood)}>{typeof Icon!=="string"&&<Icon/>}{String(mood)}</button>)}</div></label><label>Travel style<div className="chips budget-chips">{["Value","Comfort","Premium"].map(b=><button className={tripBudget===b?"selected":""} onClick={()=>setTripBudget(b)} key={b}>{b}</button>)}</div></label><div className="plan-note"><Check size={18}/><span><b>{tripMood} · {tripBudget}</b><small>Starting from {tripStart}, with meaningful stops and room to wander.</small></span></div><button className="save-plan" onClick={()=>window.print()}><CalendarDays size={17}/> Save or print this plan</button></div><div className="itinerary"><div className="itinerary-top"><div><span>PERSONALISED INSPIRATION ROUTE</span><h3>{days} days · {tripMood.toLowerCase()} pace</h3></div><Route/></div><div className="route-origin">START · {tripStart.toUpperCase()} <ArrowRight/> KANGRA VALLEY</div><div className="days">{itinerary.map((item,i)=><div className="day" key={item.title}><div className="day-marker"><span>{i+1}</span>{i<itinerary.length-1&&<i/>}</div><div><small>DAY {i+1} · {item.place}</small><h4>{item.title}</h4><p>{item.detail}</p><span className="duration"><Clock3 size={13}/> {tripMood==="Slow travel"?"Unhurried day":"Flexible day plan"}</span></div></div>)}</div><p className="disclaimer">Illustrative itinerary, not a booking or live navigation service. Verify opening times, permits, roads, routes, prices and weather locally.</p></div></div></section>

      <section className="gallery" id="gallery"><div className="gallery-head"><p className="kicker">FIELD NOTES</p><h2>Postcards from<br/><em>the quiet side.</em></h2><p>Small moments from the mountains—made to be opened.</p></div><div className="gallery-grid">{[images.trek,images.food,images.mcleod,images.kangra].map((src,i)=><button key={`${src}-${i}`} className={`gallery-item g${i+1}`} onClick={()=>setLightbox(src)}><img src={src} alt={["Triund ridge in the Dhauladhar mountains","A shared mountain meal","Tsuglagkhang in McLeod Ganj","Kangra Fort"][i]}/><span>{["Ridge stillness","At the table","Mountain light","Old stories"][i]} <Plus/></span></button>)}</div></section>

      <StoryLibrary/>
      <section className="quote-section"><Quote/><blockquote>“The mountains are not a backdrop here. They set the rhythm of every day.”</blockquote><span>— A traveller’s field note</span></section>
      <section className="trust-section"><div><ShieldCheck/><h3>Travel with context</h3><p>Photography is attributed where available. Weather, road access, permits, temple hours and trekking conditions can change quickly—verify locally before setting out.</p></div><div className="trust-list"><span>Respect sacred spaces and local customs</span><span>Use registered guides on remote routes</span><span>Carry waste back from trails</span><span>Check district advisories and forecasts</span></div><small>Content reviewed October 2026 · Coordinates and travel guidance are illustrative starting points.</small></section>
      <footer><div className="footer-main"><div className="footer-brand"><Mountain/><h2>HIMALAYA</h2><p>Travel slowly. Tread lightly.<br/>Listen to the mountains.</p></div><div className="footer-links"><div><b>EXPLORE</b><a href="#discover">Destinations</a><a href="#journey">Adventures</a><a href="#culture">Culture</a><a href="#almanac">Himachal Almanac</a><a href="#gallery">Field notes</a></div><div><b>PLAN</b><a href="#planner">Build an itinerary</a><a href="#planner">Travel guide</a><a href="#planner">Safety & seasons</a></div><div><b>FOLLOW THE TRAIL</b><a href="#top">Instagram ↗</a><a href="#top">Pinterest ↗</a><a href="#top">YouTube ↗</a></div></div></div><div className="footer-bottom"><span>© 2026 HIMALAYA · An independent travel inspiration project</span><span>Verified location photography · Wikimedia Commons, PixaHive & Hill Post · Respect local communities</span></div></footer>
      {lightbox&&<div className="lightbox" onClick={()=>setLightbox(null)}><button><X/></button><img src={lightbox} alt="Expanded travel photograph"/></div>}
      {selectedGuide&&<div className="guide-modal" onClick={()=>setSelectedGuide(null)}><article onClick={e=>e.stopPropagation()}><button className="modal-close" onClick={()=>setSelectedGuide(null)}><X/></button><span className="modal-icon">{selectedGuide.icon}</span><small>{selectedGuide.type} · {selectedGuide.district}</small><h2>{selectedGuide.name}</h2><p>{selectedGuide.detail}.</p><div className="modal-facts"><span><b>Plan carefully</b>Check season, access and local guidance.</span><span><b>Travel respectfully</b>Follow community and site-specific etiquette.</span></div><button className="modal-plan" onClick={()=>{setSelectedGuide(null);document.querySelector("#planner")?.scrollIntoView({behavior:"smooth"})}}>Add to trip inspiration <ArrowRight/></button></article></div>}
      {districtStory!==null&&<div className="district-story" role="dialog" aria-modal="true" aria-label={`${districts[districtStory].name} district story`}><button className="story-close" onClick={()=>setDistrictStory(null)} aria-label="Close district story"><X/></button><div className="story-media">{storyImage===0?<img src={districts[districtStory].image} alt={`${districts[districtStory].name}, Himachal Pradesh`}/>:<iframe title={`${districts[districtStory].name} map`} src={`https://maps.google.com/maps?q=${encodeURIComponent(districts[districtStory].name+", Himachal Pradesh")}&t=k&z=9&output=embed`} loading="lazy"/>}<div className="story-media-shade"/><div className="story-media-tabs"><button className={storyImage===0?"active":""} onClick={()=>setStoryImage(0)}>Real photograph</button><button className={storyImage===1?"active":""} onClick={()=>setStoryImage(1)}>Satellite map</button></div><div className="story-title"><small>{districtStories[districtStory].mood}</small><h2><span>{districtStories[districtStory].hindi}</span>{districts[districtStory].name}</h2><p>{districts[districtStory].copy}</p></div></div><div className="story-details"><div className="story-facts"><span><small>BEST SEASON</small><b>{districtStories[districtStory].season}</b></span><span><small>REFERENCE ELEVATION</small><b>{districtStories[districtStory].elevation}</b></span><span><small>LOCAL TABLE</small><b>{districtStories[districtStory].food}</b></span></div><div className="famous-intro"><p className="kicker">WHAT THIS DISTRICT IS FAMOUS FOR</p><h3>Sacred places, landscapes,<br/>heritage and living culture.</h3><p>A broad discovery guide to the district’s best-known places and traditions. Select any name to open its real location in Google Maps.</p></div><div className="famous-grid">{([['Sacred places','sacred'],['Nature & scenery','nature'],['Heritage & towns','heritage'],['Experiences, food & craft','experiences']] as const).map(([label,key])=><article key={key}><small>{label}</small>{districtFamous[districtStory][key].map((place,i)=><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place+", "+districts[districtStory].name+", Himachal Pradesh")}`} target="_blank" rel="noreferrer" key={place}><span>{String(i+1).padStart(2,"0")}</span><b>{place}</b><MapPin/></a>)}</article>)}</div><div className="story-columns"><article><p className="kicker">QUICK HIGHLIGHTS</p>{districtStories[districtStory].highlights.map((place,i)=><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place+", "+districts[districtStory].name+", Himachal Pradesh")}`} target="_blank" rel="noreferrer" key={place}><span>0{i+1}</span><b>{place}</b><ArrowRight/></a>)}</article><article><p className="kicker">ARRIVE WITH CONTEXT</p><div><Route/><span><b>Access</b>{districtStories[districtStory].access}</span></div><div><ShieldCheck/><span><b>Permits & care</b>{districtStories[districtStory].permit}</span></div><div><MapPin/><span><b>Emergency</b>For urgent help in India call 112. Verify local district contacts before remote travel.</span></div></article></div><div className="story-actions"><button onClick={()=>{setDistrictStory(null);document.querySelector("#planner")?.scrollIntoView({behavior:"smooth"})}}>Plan this district <ArrowRight/></button><button onClick={()=>{setStoryImage(0);setDistrictStory((districtStory+1)%districts.length)}}>Next district <ChevronRight/></button></div></div></div>}
      <div className="mobile-discovery"><a href="#districts"><Compass/><span>Explore</span></a><a href="#discover"><MapPin/><span>Places</span></a><a href="#season"><SunMedium/><span>Seasons</span></a><a href="#planner"><Route/><span>Plan</span></a></div>
    </main>
  );
}
