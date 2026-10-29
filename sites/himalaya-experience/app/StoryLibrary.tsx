"use client";
import {useEffect,useState} from "react";
import './library.css';
const entries=[
['Beas','Rivers','From the high country near Rohtang, the Beas runs through Kullu and Mandi toward Kangra.'],
['Sutlej','Rivers','The Sutlej shapes Kinnaur and the valleys around Rampur and Bilaspur.'],
['Rohtang','Passes','A mountain pass connecting the Kullu and Lahaul landscapes. Access changes with the season.'],
['Kunzum','Passes','A high pass between Lahaul and Spiti with a short summer travel window.'],
['Western tragopan','Wildlife','Himachal’s state bird inhabits temperate mountain forests.'],
['Snow leopard','Wildlife','An elusive predator of the high Himalaya and Himachal’s state animal.'],
['Kullu shawl','Craft','Wool weaving distinguished by colourful geometric borders.'],
['Chamba rumal','Craft','A distinctive embroidered textile associated with Chamba.'],
['Kangri','Languages','A regional language spoken in the Kangra region.'],
['Kinnauri traditions','People','High-valley communities preserve varied languages, weaving, architecture and seasonal celebrations.'],
['Kangra Fort','Monuments','A historic hill stronghold overlooking the Kangra landscape.'],
['Masroor','Monuments','Rock-cut temples in Kangra offer a remarkable encounter with early stone architecture.'],
['Raja Sansar Chand','History','A Kangra ruler remembered for patronage of Pahari painting.'],
['Himachali cap','Clothing','Regional colours and woven bands make the cap a visible expression of local identity.']
];
export default function StoryLibrary(){
const [query,setQuery]=useState(''),[category,setCategory]=useState('All'),[month,setMonth]=useState(4),[notes,setNotes]=useState(''),[ready,setReady]=useState(false),[status,setStatus]=useState('');
useEffect(()=>{setNotes(localStorage.getItem('himachal-journal')||'');setMonth(new Date().getMonth()+1);setReady(true)},[]);
useEffect(()=>{if(ready)localStorage.setItem('himachal-journal',notes)},[notes,ready]);
const filtered=entries.filter(e=>(category==='All'||e[1]===category)&&e.join(' ').toLowerCase().includes(query.toLowerCase()));
return <section className="story-library" id="story-library"><p className="kicker">THE HIMACHAL STORY LIBRARY</p><h2>Follow your curiosity.<br/><em>Find another Himachal.</em></h2><label className="library-search">Search the encyclopedia<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="A river, a craft, a mountain pass…"/></label><div className="library-filters">{['All',...new Set(entries.map(e=>e[1]))].map(c=><button aria-pressed={category===c} onClick={()=>setCategory(c)} key={c}>{c}</button>)}</div><div className="library-grid">{filtered.map(([name,type,copy])=><details key={name}><summary><small>{type}</small><h3>{name}</h3><span>Read the story +</span></summary><p>{copy}</p><a href={`https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(name+' Himachal Pradesh')}`} target="_blank" rel="noreferrer">Further reading ↗</a></details>)}{!filtered.length&&<p>No entries match. Try another word or category.</p>}</div><div className="library-bottom"><article><p className="kicker">A YEAR IN THE HILLS</p><h3>Choose your month.</h3><select aria-label="Discovery month" value={month} onChange={e=>setMonth(Number(e.target.value))}>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{new Date(2026,i,1).toLocaleString('en',{month:'long'})}</option>)}</select><p>{month>=7&&month<=9?'Monsoon brings deep greens and cloud-filled valleys. Build flexibility into road journeys.':month>=11||month<=2?'Winter brings quiet foothill visits and snow at higher elevations. High routes may be closed.':month>=3&&month<=5?'Spring moves upward through the valleys: fresh leaves, orchard blossoms and clear mountain mornings.':'Longer days invite valley walks and orchard landscapes; high-country access depends on local conditions.'}</p></article><article><p className="kicker">YOUR MOUNTAIN JOURNAL</p><h3>Keep a little of the hills.</h3><label>Places, memories & plans<textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="My Himachal journey…"/></label><small>Saved on this device.</small><button onClick={()=>{const blob=new Blob([notes],{type:'text/plain'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='my-himachal-journal.txt';a.click();URL.revokeObjectURL(url);setStatus('Journal downloaded')}}>Download your journal ↓</button><span role="status">{status}</span></article></div></section>
}
