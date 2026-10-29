"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";

function Deodar({ still }: { still: boolean }) {
  // The runtime objects are Three.js groups supplied by React Three Fiber.
  // Keeping this local structural type avoids requiring Cloudflare's bundled
  // Three.js declarations in the Vercel build.
  const tree = useRef<Group>(null);
  const crown = useRef<Group>(null);
  const tiers = useMemo(() => [
    { y: .9, r: 2.45, branches: 13 },
    { y: 1.75, r: 2.28, branches: 12 },
    { y: 2.65, r: 2.05, branches: 12 },
    { y: 3.55, r: 1.75, branches: 11 },
    { y: 4.35, r: 1.42, branches: 10 },
    { y: 5.05, r: 1.02, branches: 9 },
    { y: 5.65, r: .66, branches: 8 },
  ], []);

  useFrame(({ clock, pointer }) => {
    if (!tree.current || !crown.current || still) return;
    const t = clock.getElapsedTime();
    tree.current.rotation.y += (pointer.x * .16 - tree.current.rotation.y) * .025;
    tree.current.rotation.x += (-pointer.y * .025 - tree.current.rotation.x) * .025;
    crown.current.rotation.z = Math.sin(t * .72) * .012;
  });

  return (
    <group ref={tree} position={[1.2, -3.7, 0]} rotation={[0, -.18, 0]}>
      <mesh castShadow receiveShadow position={[0, 2.35, 0]}>
        <cylinderGeometry args={[.16, .48, 6.4, 24]} />
        <meshStandardMaterial color="#4b3427" roughness={1} metalness={0} />
      </mesh>
      <group ref={crown}>
        {tiers.map((tier, index) => (
          <group key={tier.y} position={[0, tier.y, 0]} rotation={[0, index * .39, 0]}>
            {Array.from({ length: tier.branches }, (_, branch) => {
              const angle = branch / tier.branches * Math.PI * 2;
              const length = tier.r * (.78 + ((branch * 7 + index) % 5) * .045);
              const droop = -.08 - (index < 3 ? .12 : .04);
              return (
                <group key={branch} rotation={[0, -angle, droop]}>
                  <mesh castShadow position={[length * .48, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[.025, .07, length, 8]} />
                    <meshStandardMaterial color="#4a3425" roughness={1} />
                  </mesh>
                  {[.34, .58, .8, 1].map((step, tuft) => {
                    const size = (.3 - index * .018) * (1 - tuft * .06);
                    const offset = (branch + tuft + index) % 2 ? .11 : -.11;
                    return (
                      <group key={step} position={[length * step, offset, 0]} rotation={[0, 0, (tuft - 1.5) * .08]}>
                        <mesh castShadow scale={[1.55, .6, .72]}>
                          <icosahedronGeometry args={[size, 1]} />
                          <meshStandardMaterial color={(branch + tuft) % 3 === 0 ? "#285b42" : (branch + tuft) % 3 === 1 ? "#1d4936" : "#35694d"} roughness={.96} />
                        </mesh>
                        <mesh position={[0, size * .45, 0]} scale={[1.05, .16, .46]}>
                          <icosahedronGeometry args={[size, 1]} />
                          <meshStandardMaterial color="#e4e9e2" roughness={1} transparent opacity={.74} />
                        </mesh>
                      </group>
                    );
                  })}
                </group>
              );
            })}
          </group>
        ))}
        {Array.from({ length: 8 }, (_, tip) => (
          <mesh key={tip} castShadow position={[Math.sin(tip * 1.7) * .16, 6 + tip * .09, Math.cos(tip * 1.4) * .15]} scale={[.55, 1.5, .55]}>
            <icosahedronGeometry args={[.28 - tip * .018, 1]} />
            <meshStandardMaterial color={tip % 2 ? "#24543d" : "#32684b"} roughness={.95} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export default function DeodarTree() {
  const [still, setStill] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <div className="tree-3d-stage" aria-label="Interactive 3D Himalayan deodar tree">
      <div className="tree-3d-label"><i/><span><b>LIVE 3D DEODAR</b><small>Move to explore</small></span></div>
      <Canvas camera={{ position: [0, 1.6, 10.5], fov: 38 }} dpr={[1, 1.5]} shadows gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={1.15} />
        <directionalLight position={[-4, 8, 7]} intensity={2.6} color="#f8e4bf" castShadow />
        <directionalLight position={[5, 1, -4]} intensity={1.2} color="#8fc7bd" />
        <fog attach="fog" args={["#102634", 10, 18]} />
        <Deodar still={still} />
      </Canvas>
    </div>
  );
}
