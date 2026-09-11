(() => {
  const reducedMotion = () =>
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  const resolveTargets = (targets) =>
    Array.from(targets || []).filter((target) => target instanceof Element);

  const visibleTargets = (targets) =>
    resolveTargets(targets).filter((target) => !target.hidden);

  const resetTargets = (targets) => {
    if (!window.gsap || !targets.length) return;
    window.gsap.set(targets, { clearProps: "opacity,transform" });
  };

  function animateIn(targets, options = {}) {
    const elements = visibleTargets(targets);
    if (!elements.length) return;
    if (!window.gsap || reducedMotion()) {
      resetTargets(elements);
      return;
    }

    window.gsap.killTweensOf(elements);
    window.gsap.fromTo(
      elements,
      { autoAlpha: options.fromAlpha ?? 0, y: options.y ?? 9 },
      {
        autoAlpha: 1,
        y: 0,
        duration: options.duration ?? 0.26,
        delay: options.delay ?? 0,
        stagger: options.stagger ?? 0.05,
        ease: "power1.out",
        overwrite: "auto",
        clearProps: "opacity,transform",
      },
    );
  }

  function pageEnter(elements) {
    animateIn(elements, { duration: 0.28, y: 10, stagger: 0.06 });
  }

  function switchOut(elements) {
    const targets = visibleTargets(elements);
    if (!window.gsap || reducedMotion() || !targets.length) return;

    window.gsap.killTweensOf(targets);
    window.gsap.to(targets, {
      autoAlpha: 0.68,
      y: 3,
      duration: 0.12,
      ease: "power1.out",
      overwrite: "auto",
    });
  }

  function switchIn(elements) {
    animateIn(elements, {
      fromAlpha: 0.68,
      duration: 0.22,
      y: 5,
      stagger: 0.035,
    });
  }

  // K62 / K70 only: simple smooth content fade. No flip, tilt, scale, or slide.
  function pageTurnOut(element) {
    if (!(element instanceof Element)) return Promise.resolve();
    if (!window.gsap || reducedMotion()) {
      resetTargets([element]);
      return Promise.resolve();
    }

    window.gsap.killTweensOf(element);
    return new Promise((resolve) => {
      window.gsap.to(element, {
        opacity: 0,
        duration: 0.16,
        ease: "power1.out",
        overwrite: "auto",
        onComplete: resolve,
      });
    });
  }

  function pageTurnIn(element) {
    if (!(element instanceof Element)) return Promise.resolve();
    if (!window.gsap || reducedMotion()) {
      resetTargets([element]);
      return Promise.resolve();
    }

    window.gsap.killTweensOf(element);
    window.gsap.set(element, { opacity: 0 });
    return new Promise((resolve) => {
      window.gsap.to(element, {
        opacity: 1,
        duration: 0.28,
        ease: "power1.out",
        overwrite: "auto",
        clearProps: "opacity",
        onComplete: resolve,
      });
    });
  }

  function cardsIn(elements) {
    animateIn(elements, { duration: 0.22, y: 7, stagger: 0.025 });
  }

  function modalOpen(overlay, modal) {
    if (!window.gsap || reducedMotion() || !overlay || !modal) return;

    const isMaterialDetail = modal.classList.contains("stock-modal");
    const flipCard = isMaterialDetail ? modal.querySelector(".material-flip-card") : null;
    const materialFaces = flipCard
      ? flipCard.querySelectorAll(".material-front, .material-back")
      : [];
    const animationTarget = flipCard || modal;
    window.gsap.killTweensOf([overlay, animationTarget, ...materialFaces]);
    window.gsap.set(overlay, { autoAlpha: 0 });

    if (flipCard) {
      window.gsap.to(overlay, {
        autoAlpha: 1,
        duration: 0.18,
        ease: "power1.out",
        overwrite: "auto",
      });
      window.gsap.set(flipCard, {
        autoAlpha: 1,
        rotationX: -6,
        rotationY: 180,
        scale: 0.72,
        y: 18,
        z: -140,
        transformPerspective: 1500,
        transformOrigin: "50% 50%",
        force3D: true,
      });
      window.gsap.set(materialFaces, { autoAlpha: 0 });
      window.gsap
        .timeline({
          defaults: { overwrite: "auto", force3D: true },
          onComplete: () => {
            window.gsap.set(flipCard, { clearProps: "transform,transformOrigin" });
          },
        })
        .to(flipCard, {
          rotationY: 115,
          scale: 0.82,
          y: 8,
          z: -50,
          duration: 0.16,
          ease: "power3.in",
        })
        .to(materialFaces, { autoAlpha: 1, duration: 0.16, ease: "power1.out" }, 0)
        .to(flipCard, {
          rotationY: 65,
          scale: 0.91,
          z: 20,
          duration: 0.12,
          ease: "power2.inOut",
        })
        .to(flipCard, {
          rotationY: 18,
          rotationX: -1,
          scale: 0.985,
          y: 1,
          z: 5,
          duration: 0.28,
          ease: "power4.out",
        })
        .to(flipCard, {
          rotationY: 0,
          rotationX: 0,
          scale: 1,
          y: 0,
          z: 0,
          duration: 0.24,
          ease: "expo.out",
        });
      return;
    }

    window.gsap.to(overlay, {
      autoAlpha: 1,
      duration: 0.2,
      ease: "power1.out",
      overwrite: "auto",
    });

    window.gsap.set(modal, { autoAlpha: 0, y: 6, z: 0, scale: 0.98, rotationX: 0, rotationY: 0 });
    window.gsap.to(modal, {
      autoAlpha: 1,
      y: 0,
      z: 0,
      scale: 1,
      rotationX: 0,
      rotationY: 0,
      duration: 0.22,
      ease: "power1.out",
      overwrite: "auto",
      onComplete: () => {
        window.gsap.set(modal, { clearProps: "transform,transformOrigin" });
      },
    });
  }

  function modalClose(overlay, modal, done) {
    if (
      !window.gsap ||
      reducedMotion() ||
      !overlay ||
      !modal ||
      !overlay.classList.contains("show")
    ) {
      done?.();
      return;
    }

    const flipCard = modal.classList.contains("stock-modal")
      ? modal.querySelector(".material-flip-card")
      : null;
    const materialFaces = flipCard
      ? flipCard.querySelectorAll(".material-front, .material-back")
      : [];
    const animationTarget = flipCard || modal;
    window.gsap.killTweensOf([overlay, animationTarget, ...materialFaces]);

    if (flipCard) {
      window.gsap.set(materialFaces, { autoAlpha: 1 });
      window.gsap
        .timeline({
          defaults: { overwrite: "auto", force3D: true },
          onComplete: done,
        })
        .to(flipCard, {
          rotationY: 18,
          rotationX: -1,
          scale: 0.985,
          y: 1,
          z: 5,
          duration: 0.24,
          ease: "expo.in",
        })
        .to(flipCard, {
          rotationY: 65,
          rotationX: -6,
          scale: 0.91,
          y: 8,
          z: 20,
          duration: 0.28,
          ease: "power4.in",
        })
        .to(flipCard, {
          rotationY: 115,
          scale: 0.82,
          z: -50,
          duration: 0.12,
          ease: "power2.inOut",
        })
        .to(flipCard, {
          rotationY: 180,
          scale: 0.72,
          y: 18,
          z: -140,
          duration: 0.16,
          ease: "power3.out",
        })
        .to(materialFaces, { autoAlpha: 0, duration: 0.16, ease: "power1.in" }, "-=0.16")
        .to(overlay, { autoAlpha: 0, duration: 0.18, ease: "power1.in" }, "-=0.18");
      return;
    }

    const closeProps = { autoAlpha: 0, y: 6, z: 0, scale: 0.98, rotationX: 0, rotationY: 0 };
    window.gsap
      .timeline({
        defaults: { duration: 0.17, ease: "power1.in", overwrite: "auto" },
        onComplete: done,
      })
      .to(overlay, { autoAlpha: 0 }, 0)
      .to(animationTarget, closeProps, 0);
  }

  function dropdownOpen(element) {
    if (!window.gsap || reducedMotion() || !element) return;

    window.gsap.killTweensOf(element);
    window.gsap.set(element, { autoAlpha: 0, y: -4, scale: 0.98 });
    window.gsap.to(element, {
      autoAlpha: 1,
      y: 0,
      scale: 1,
      duration: 0.17,
      ease: "power1.out",
      overwrite: "auto",
    });
  }

  function dropdownClose(element, done) {
    if (!window.gsap || reducedMotion() || !element) {
      done?.();
      return;
    }

    window.gsap.killTweensOf(element);
    window.gsap.to(element, {
      autoAlpha: 0,
      y: -4,
      scale: 0.98,
      duration: 0.13,
      ease: "power1.in",
      overwrite: "auto",
      onComplete: done,
    });
  }

  window.appAnimations = {
    pageEnter,
    switchOut,
    switchIn,
    pageTurnOut,
    pageTurnIn,
    cardsIn,
    modalOpen,
    modalClose,
    dropdownOpen,
    dropdownClose,
  };
})();
