---
layout: archive
title: "Uni"
permalink: /UniCourse/
author_profile: true
---


<div class="wordwrap">Personal Uni Course Notes</div>

{% include base_path %}

{% for post in site.UniCourse reversed %}
  {% include archive-single.html %}
{% endfor %}
