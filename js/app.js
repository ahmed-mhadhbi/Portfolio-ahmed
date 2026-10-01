(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touch = matchMedia("(hover: none)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ─── Loader ─── */
  const loader = $("#loader");
  const loaderCount = $("#loaderCount");
  const loaderBar = $("#loaderBar");
  let loadProgress = 0;

  function setLoader(n) {
    loadProgress = clamp(n, 0, 100);
    if (loaderCount) loaderCount.textContent = String(Math.round(loadProgress)).padStart(2, "0");
    if (loaderBar) loaderBar.style.width = `${loadProgress}%`;
  }

  function finishLoader() {
    setLoader(100);
    requestAnimationFrame(() => {
      setTimeout(() => {
        loader?.classList.add("is-done");
        $("#top")?.classList.add("is-ready");
        document.body.classList.add("is-loaded");
      }, reduced ? 0 : 280);
    });
  }

  /* ─── Soft preload of critical assets ─── */
  // Reuse the visible portrait's decoder rather than downloading a second video.
  Promise.race([
    document.fonts?.ready || Promise.resolve(),
    new Promise((resolve) => setTimeout(resolve, 900)),
  ]).then(finishLoader);

  // safety timeout
  setTimeout(() => {
    if (!document.body.classList.contains("is-loaded")) finishLoader();
  }, 2800);

  setLoader(8);

  /* ─── Touch hint swap (CSS also handles hover:none) ─── */
  if (touch) {
    const mouse = $(".hint-mouse");
    const finger = $(".hint-touch");
    if (mouse) mouse.hidden = true;
    if (finger) {
      finger.hidden = false;
      finger.removeAttribute("hidden");
    }
  }

  /* ─── Portrait scrub (signature interaction) ─── */
  const DOWN = 2.7;
  const DAMP = 0.09;
  const PAR = 12;
  const portrait = $("#portrait");
  const figure = $("#portraitCanvas");
  const grid = $("#heroGrid");

  let ty = 0.5;
  let tx = 0;
  let cy = 0.5;
  let cx = 0;
  let last = -1;
  let ready = false;
  let idle = 0;

  /* Remove the baked white studio backdrop, preserving the original color.
     Upload a texture only after a seek: no continuous canvas/video redraw. */
  let drawPortrait = () => {};
  if (figure && portrait) {
    const gl = figure.getContext("webgl", { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (gl) {
      const shader = (type, source) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, source); gl.compileShader(s);
        return s;
      };
      const program = gl.createProgram();
      gl.attachShader(program, shader(gl.VERTEX_SHADER, `attribute vec2 position; varying vec2 uv; void main(){uv=vec2((position.x+1.0)*.5,(1.0-position.y)*.5);gl_Position=vec4(position,0.,1.);}`));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `precision mediump float; varying vec2 uv; uniform sampler2D frame; uniform sampler2D shoeMask; void main(){vec3 c=texture2D(frame,uv).rgb;float white=min(c.r,min(c.g,c.b));float a=max(1.-smoothstep(.80,.965,white),texture2D(shoeMask,uv).a);vec3 clean=clamp((c-vec3(1.-a))/max(a,.001),0.,1.);gl_FragColor=vec4(clean,a);}`));
      gl.linkProgram(program); gl.useProgram(program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const pos = gl.getAttribLocation(program,"position"); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.uniform1i(gl.getUniformLocation(program,"frame"),0);
      // The feet stay fixed in this portrait clip. Protect their off-white
      // interiors from the studio-background key with an asset-specific matte.
      const matte=document.createElement("canvas");matte.width=720;matte.height=900;
      const ctx=matte.getContext("2d");ctx.fillStyle="#fff";
      for(const points of [
        [[294,785],[318,790],[351,797],[354,817],[344,825],[320,832],[300,842],[279,846],[256,845],[251,841],[253,830],[265,815],[281,804]],
        [[426,825],[451,820],[481,809],[494,815],[505,832],[523,842],[537,852],[541,862],[537,868],[524,873],[508,874],[490,870],[470,863],[448,856],[428,849]],
      ]) {ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();}
      gl.activeTexture(gl.TEXTURE1);
      const maskTexture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,maskTexture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,matte);
      gl.uniform1i(gl.getUniformLocation(program,"shoeMask"),1);gl.activeTexture(gl.TEXTURE0);
      drawPortrait = () => {
        if (portrait.readyState < 2 || gl.isContextLost()) return;
        if (figure.width !== portrait.videoWidth) {figure.width=portrait.videoWidth;figure.height=portrait.videoHeight;gl.viewport(0,0,figure.width,figure.height);}
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,portrait);
        gl.drawArrays(gl.TRIANGLES,0,6);
        figure.style.background="none";
        figure.classList.add("is-ok");
      };
      figure.addEventListener("webglcontextlost", (e) => { e.preventDefault(); figure.style.background='url(assets/portrait-fallback.png) center / contain no-repeat'; });
    } else {
      figure.style.background='url(assets/portrait-fallback.png) center / contain no-repeat';
      figure.classList.add("is-ok");
    }
    portrait.addEventListener("seeked", drawPortrait);
    portrait.addEventListener("loadeddata", drawPortrait);
  }

  if (portrait) {
    portrait.addEventListener("loadeddata", () => {
      try {
        portrait.currentTime = DOWN * 0.5;
      } catch (_) {}
    });
    portrait.addEventListener(
      "seeked",
      () => {
        ready = true;
        portrait.classList.add("is-ok");
        drawPortrait();
      },
      { once: true }
    );
    // fallback if seeked never fires
    setTimeout(() => {
      if (!portrait.classList.contains("is-ok")) portrait.classList.add("is-ok");
      figure?.classList.add("is-ok");
    }, 1600);
  }

  addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      ty = clamp(e.clientY / innerHeight, 0, 1);
      tx = (e.clientX / innerWidth) * 2 - 1;
      wake();
    },
    { passive: true }
  );

  const onTouch = (e) => {
    const t = e.touches[0];
    if (!t) return;
    ty = clamp(t.clientY / innerHeight, 0, 1);
    tx = (t.clientX / innerWidth) * 2 - 1;
    idle = performance.now();
    wake();
  };
  addEventListener("touchstart", onTouch, { passive: true });
  addEventListener("touchmove", onTouch, { passive: true });
  addEventListener("touchend", () => (idle = performance.now()), { passive: true });

  /* ─── Custom cursor ─── */
  const dot = $("#cursorDot");
  const ring = $("#cursorRing");
  let px = -99;
  let py = -99;
  let rx = -99;
  let ry = -99;
  let lab = "";

  if (finePointer && !reduced) {
    document.documentElement.classList.add("has-cursor");
    addEventListener(
      "pointermove",
      (e) => {
        px = e.clientX;
        py = e.clientY;
        const t = e.target.closest?.("[data-cursor]");
        const l = t ? t.dataset.cursor : "";
        if (l !== lab) {
          lab = l;
          ring?.classList.toggle("is-hover", !!l);
          if (ring) ring.textContent = l;
        }
      },
      { passive: true }
    );
  }

  /* ─── Mail magnetic + letter split ─── */
  const mail = $("#mail");
  if (mail) {
    const text = mail.textContent;
    mail.innerHTML = [...text]
      .map((c, i) => `<span style="--i:${i}">${c === " " ? "&nbsp;" : c}</span>`)
      .join("");

    if (finePointer && !reduced) {
      mail.addEventListener("pointermove", (e) => {
        const r = mail.getBoundingClientRect();
        mail.style.translate = `${(e.clientX - r.left - r.width / 2) * 0.1}px ${(e.clientY - r.top - r.height / 2) * 0.22}px`;
      });
      mail.addEventListener("pointerleave", () => {
        mail.style.translate = "";
      });
    }
  }

  /* ─── Lazy video loading ─── */
  const projectVideos = $$("video[data-src]");

  function loadVideo(el) {
    if (el.dataset.loaded) return;
    el.dataset.loaded = "1";
    el.preload = reduced ? "metadata" : "auto";
    el.src = el.dataset.src;
    el.load();
    el.addEventListener(
      "loadeddata",
      () => {
        if (el.dataset.wantPlay === "1") playSafe(el);
      },
      { once: true }
    );
  }

  function playSafe(el) {
    el.dataset.wantPlay = "1";
    if (!el.src) loadVideo(el);
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  function pauseSafe(el) {
    el.dataset.wantPlay = "0";
    if (!el.paused) el.pause();
  }

  const videoIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const v = entry.target;
        if (entry.isIntersecting) {
          loadVideo(v);
          if (!reduced && !document.hidden) playSafe(v);
        } else {
          pauseSafe(v);
        }
      });
    },
    { rootMargin: "0px", threshold: 0.05 }
  );

  projectVideos.forEach((v) => videoIO.observe(v));
  const warmIO = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) { loadVideo(entry.target); warmIO.unobserve(entry.target); }
    });
  }, {rootMargin:"50% 0px"});
  if (!navigator.connection?.saveData) projectVideos.forEach(v => warmIO.observe(v));

  /* ─── Reveal on scroll (lightweight) ─── */
  const revealIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          revealIO.unobserve(e.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -8% 0px" }
  );
  $$(".reveal").forEach((el) => revealIO.observe(el));

  /* ─── Nav solid state + active section ─── */
  const nav = $("#nav");
  const navLinks = $$(".nav__links a");
  const sections = $$("[data-section]");

  function updateNav() {
    if (!nav) return;
    nav.classList.toggle("is-solid", scrollY > innerHeight * 0.55);

    let current = "top";
    for (const s of sections) {
      const r = s.getBoundingClientRect();
      if (r.top <= innerHeight * 0.35) current = s.dataset.section;
    }
    navLinks.forEach((a) => {
      const href = a.getAttribute("href")?.slice(1);
      a.classList.toggle("is-active", href === current);
    });
  }

  /* ─── Smooth anchor scroll ─── */
  $$('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (!id || id === "#") return;
      const target = $(id);
      if (!target) return;
      e.preventDefault();
      const y = target.getBoundingClientRect().top + scrollY - (nav?.offsetHeight || 0);
      scrollTo({ top: y, behavior: reduced ? "auto" : "smooth" });
    });
  });

  /* ─── RAF loop: portrait + cursor ─── */
  let frameId = 0;
  function wake() {
    if (!frameId && !document.hidden && !reduced) frameId = requestAnimationFrame(tick);
  }
  function tick(now) {
    frameId = 0;
    if (touch && idle && now - idle > 1400) {
      ty = 0.5;
      tx = 0;
    }

    cy += (ty - cy) * DAMP;
    cx += (tx - cx) * 0.06;

    if (!reduced && scrollY < innerHeight * 1.15 && portrait) {
      const t = cy * DOWN;
      if (ready && !portrait.seeking && Math.abs(t - last) > 0.025) {
        try {
          portrait.currentTime = t;
          last = t;
        } catch (_) {}
      }
      if (figure) {
        figure.style.transform = `translate3d(${cx * PAR}px,0,0) perspective(1100px) rotateY(${cx * 3}deg)`;
      } else if (portrait) {
        portrait.style.transform = `translate3d(${cx * PAR}px,0,0) perspective(1100px) rotateY(${cx * 3}deg)`;
      }
      if (grid) grid.style.transform = `translate3d(${cx * -4}px,0,0)`;
    }

    if (finePointer && !reduced && dot && ring) {
      rx += (px - rx) * 0.2;
      ry += (py - ry) * 0.2;
      dot.style.transform = `translate3d(${px}px,${py}px,0)`;
      ring.style.transform = `translate3d(${rx}px,${ry}px,0)`;
    }

    const settling = Math.abs(cx-tx)>.001 || Math.abs(cy-ty)>.001 || Math.abs(px-rx)>.1 || Math.abs(py-ry)>.1;
    if (settling || (touch && idle && now-idle<1500)) wake();
  }
  wake();
  addEventListener("pointermove", wake, {passive:true});
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(frameId); frameId=0; projectVideos.forEach(pauseSafe); }
    else { wake(); projectVideos.forEach(v=>{const r=v.getBoundingClientRect();if(!reduced && r.bottom>0 && r.top<innerHeight) playSafe(v);}); }
  });

  addEventListener("scroll", updateNav, { passive: true });
  updateNav();

  /* ═══════════════════════════════════════
     GSAP ScrollTrigger storytelling
  ═══════════════════════════════════════ */
  function initScroll() {
    if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") return;
    gsap.registerPlugin(ScrollTrigger);

    document.documentElement.classList.toggle("static-projects", reduced);
    if (reduced) {
      // show final states without animation
      gsap.set("#p1Info", { opacity: 1, y: 0 });
      gsap.set("#p1Veil", { opacity: 1 });
      gsap.set("#p3Left, #p3Right, #p3Meta", { opacity: 1 });
      return;
    }

    const mm = gsap.matchMedia();

    /* ── Project 01: cinematic scale ── */
    mm.add("(min-width: 801px)", () => {
      const wrap = $("#p1VideoWrap");
      const info = $("#p1Info");
      const veil = $("#p1Veil");
      const num = $(".p1__num");
      if (!wrap) return;

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: ".p1",
          start: "top top",
          end: "bottom bottom",
          scrub: 1.1,
        },
      });

      tl.fromTo(
        wrap,
        {
          width: () => Math.min(innerWidth * 0.72, 1100),
          borderRadius: 4,
          scale: 0.92,
        },
        {
          width: () => innerWidth,
          borderRadius: 0,
          scale: 1,
          ease: "none",
          duration: 0.55,
        }
      )
        .to(veil, { opacity: 1, ease: "none", duration: 0.25 }, 0.2)
        .to(info, { opacity: 1, y: 0, ease: "none", duration: 0.2 }, 0.3)
        .to(num, { opacity: 0.15, x: -40, ease: "none", duration: 0.4 }, 0.2);

      return () => tl.scrollTrigger?.kill();
    });

    /* ── Project 02: sticky split chapters ── */
    mm.add("(min-width: 961px)", () => {
      const pin = $("#p2Pin");
      const panels = $$(".p2__panel");
      const bars = $$("#p2Progress span i");
      if (!pin || !panels.length) return;

      // Create scroll space via Spacer approach — pin the split
      let previousChapter = -1;
      const st = ScrollTrigger.create({
        trigger: pin,
        start: "top top",
        end: () => `+=${innerHeight * 2.4}`,
        pin: true,
        scrub: 0.8,
        anticipatePin: 1,
        onUpdate: (self) => {
          const p = self.progress;
          const idx = p < 0.33 ? 0 : p < 0.66 ? 1 : 2;
          if (idx !== previousChapter) panels.forEach((panel, i) => {
            const on = i === idx;
            panel.classList.toggle("is-active", on);
            if (on) {
              gsap.to(panel, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out", overwrite: true });
            } else {
              gsap.to(panel, { opacity: 0, y: 20, duration: 0.35, ease: "power2.in", overwrite: true });
            }
          });
          previousChapter = idx;
          bars.forEach((bar, i) => {
            let fill = 0;
            if (i < idx) fill = 1;
            else if (i === idx) {
              const local = (p - idx * 0.33) / 0.33;
              fill = clamp(local, 0, 1);
            }
            gsap.set(bar, { scaleX: fill });
          });
        },
      });

      // subtle video parallax
      const vid = $("#vid2");
      if (vid) {
        gsap.fromTo(
          vid,
          { scale: 1.08 },
          {
            scale: 1,
            ease: "none",
            scrollTrigger: {
              trigger: pin,
              start: "top top",
              end: () => `+=${innerHeight * 2.4}`,
              scrub: true,
            },
          }
        );
      }

      return () => st.kill();
    });

    /* ── Project 03: browser frame → expansive ── */
    mm.add("(min-width: 801px)", () => {
      const chrome = $("#p3Chrome");
      const bar = $("#p3Bar");
      const left = $("#p3Left");
      const right = $("#p3Right");
      const meta = $("#p3Meta");
      if (!chrome) return;

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: ".p3",
          start: "top top",
          end: "bottom bottom",
          scrub: 1.15,
        },
      });

      tl.fromTo(
        chrome,
        {
          width: () => Math.min(innerWidth * 0.58, 820),
          borderRadius: 0,
          y: 40,
        },
        {
          width: () => Math.min(innerWidth * 0.94, innerWidth - 48),
          borderRadius: 0,
          y: 0,
          ease: "none",
          duration: 0.55,
        }
      )
        .to(bar, { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, ease: "none", duration: 0.25 }, 0.35)
        .fromTo(left, { opacity: 0, x: -40 }, { opacity: 1, x: 0, ease: "none", duration: 0.22 }, 0.08)
        .fromTo(right, { opacity: 0, x: 40 }, { opacity: 1, x: 0, ease: "none", duration: 0.22 }, 0.18)
        .to(left, { opacity: 0, ease: "none", duration: 0.18 }, 0.48)
        .to(right, { opacity: 0, ease: "none", duration: 0.18 }, 0.5)
        .fromTo(meta, { opacity: 0, y: 24 }, { opacity: 1, y: 0, ease: "none", duration: 0.2 }, 0.45);

      return () => tl.scrollTrigger?.kill();
    });

    /* Contact title entrance */
    gsap.from(".contact__title", {
      y: 48,
      opacity: 0,
      ease: "power3.out",
      duration: 1.05,
      immediateRender: false,
      scrollTrigger: {
        trigger: ".contact",
        start: "top 80%",
        toggleActions: "play none none none",
        once: true,
      },
    });

    gsap.from(".contact__label", {
      y: 16,
      opacity: 0,
      ease: "power3.out",
      duration: 0.8,
      immediateRender: false,
      scrollTrigger: {
        trigger: ".contact",
        start: "top 80%",
        toggleActions: "play none none none",
        once: true,
      },
    });

    ScrollTrigger.refresh();
  }

  // Wait for GSAP (defer scripts)
  function whenGsap(cb) {
    if (typeof gsap !== "undefined" && typeof ScrollTrigger !== "undefined") {
      cb();
      return;
    }
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      if (typeof gsap !== "undefined" && typeof ScrollTrigger !== "undefined") {
        clearInterval(id);
        cb();
      } else if (n > 40) {
        clearInterval(id);
        document.documentElement.classList.add("static-projects");
      }
    }, 50);
  }

  whenGsap(initScroll);

  /* Refresh ScrollTrigger on resize (debounced) */
  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh();
    }, 220);
  });
})();
